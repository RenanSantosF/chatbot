import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * De seis em seis horas.
 *
 * O prazo de guarda é medido em DIAS, então varrer de hora em hora seria
 * gasto sem ganho: quatro passadas por dia deixam a conta em dia com folga
 * e distribuem o apagamento em lotes menores.
 */
const INTERVALO_MS = 6 * 60 * 60 * 1000;

/**
 * Espera antes da primeira varredura.
 *
 * A subida do processo já é o momento mais carregado — migração, conexão
 * de banco, reconexão dos sockets. Um DELETE em massa competindo com isso
 * atrasa justamente o que a pessoa está olhando: o painel voltando.
 */
const ATRASO_INICIAL_MS = 5 * 60 * 1000;

/**
 * A varredura que faz o prazo de guarda valer.
 *
 * ELA NÃO EXISTIA, e essa é a razão deste arquivo. `purgeAll` estava
 * escrito, testado e completo dentro do RetentionService — e ninguém o
 * chamava. A tela de armazenamento dizia "passado o prazo, as mensagens
 * são apagadas", o prazo passava, e nada era apagado. Só o botão "Limpar
 * agora" funcionava, o que transforma uma política de retenção em uma
 * tarefa manual que ninguém lembra de fazer.
 *
 * Por que uma classe à parte, e não um timer no RetentionService: aquele
 * serviço injeta o TenantPrismaService e por isso tem ESCOPO DE
 * REQUISIÇÃO — o Nest cria uma instância por chamada HTTP. Um serviço
 * assim não tem onde pendurar um timer, e é essa a explicação de o
 * `purgeAll` ter nascido órfão: não havia de onde chamá-lo. Aqui o
 * escopo é o do processo, como no AutoCloseService, e o isolamento
 * continua explícito — cada consulta carrega o tenantId da configuração
 * que a originou.
 */
/** Lote de apagamento: pequeno o bastante pra não segurar o banco. */
const LOTE = 500;

/** Teto de lotes por passada — o resto fica pra próxima varredura. */
const MAXIMO_DE_LOTES = 200;

/** Ao encher, apaga até sobrar esta fração da cota (folga pra não encher de novo amanhã). */
export const ALVO_AO_LIBERAR = 0.9;

/** Quantos arquivos antigos (sem tamanho gravado) medir por passada. */
const TAMANHOS_POR_PASSADA = 300;

export interface Medicao {
  /** Texto + arquivos, em bytes. */
  usedBytes: number;
  textBytes: number;
  fileBytes: number;
  messages: number;
}

@Injectable()
export class RetentionSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionSweepService.name);
  private timer?: NodeJS.Timeout;
  private primeira?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    // `unref` nos dois pra nenhum deles segurar o processo de pé no
    // encerramento — sem isso o container demora a morrer e o deploy
    // parece travado.
    this.primeira = setTimeout(() => {
      void this.varrer();
      this.timer = setInterval(() => void this.varrer(), INTERVALO_MS);
      this.timer.unref();
    }, ATRASO_INICIAL_MS);
    this.primeira.unref();
  }

  onModuleDestroy() {
    if (this.primeira) clearTimeout(this.primeira);
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Quanto a empresa ocupa: o texto das mensagens no banco MAIS os
   * arquivos guardados no bucket.
   *
   * O tamanho de cada arquivo é gravado no metadado da mensagem na hora
   * de guardar (`storageBytes`, ver WhatsappMediaService.arquivar), e não
   * lido do bucket: listar o bucket exige `s3:ListBucket`, que a chave de
   * acesso da plataforma pode não ter. Arquivo guardado antes disso ganha
   * o tamanho aos poucos (ver `preencherTamanhos`).
   *
   * O resultado fica gravado na conta (`usedBytes`), que é de onde o aviso
   * de "quase cheio" do painel lê sem recalcular a cada tela.
   */
  async medir(tenantId: string): Promise<Medicao> {
    const [linha] = await this.prisma.client.$queryRaw<
      { texto: bigint; arquivos: bigint; total: bigint }[]
    >`
      SELECT COALESCE(SUM(pg_column_size(m.*)), 0)::bigint AS texto,
             COALESCE(SUM(
               CASE WHEN jsonb_typeof(m.metadata -> 'storageBytes') = 'number'
                    THEN (m.metadata ->> 'storageBytes')::bigint ELSE 0 END
             ), 0)::bigint AS arquivos,
             COUNT(*)::bigint AS total
      FROM messages m
      WHERE m."tenantId" = ${tenantId}
    `;
    const textBytes = Number(linha?.texto ?? 0n);
    const fileBytes = Number(linha?.arquivos ?? 0n);
    const usedBytes = textBytes + fileBytes;

    await this.prisma.client.billingAccount.updateMany({
      where: { tenantId },
      data: { usedBytes: BigInt(usedBytes), measuredAt: new Date() },
    });

    return {
      usedBytes,
      textBytes,
      fileBytes,
      messages: Number(linha?.total ?? 0n),
    };
  }

  /**
   * Apaga mensagens da mais antiga pra mais nova — e os arquivos delas no
   * bucket junto.
   *
   * Antes o apagamento por prazo tirava só a linha do banco: o arquivo
   * ficava no bucket pra sempre, ocupando espaço e guardando documento de
   * cliente que a empresa mandou apagar. Aqui a chave de cada arquivo sai
   * na mesma consulta que escolhe as mensagens.
   *
   * Dois critérios: `antesDe` (prazo de guarda) apaga tudo que é mais velho
   * que a data; `bytesALiberar` (cota cheia) apaga só até somar o espaço
   * pedido. Em lotes, com teto por passada.
   */
  private async apagarMensagens(
    tenantId: string,
    criterio: { antesDe?: Date; bytesALiberar?: number },
  ): Promise<{ mensagens: number; bytes: number }> {
    let mensagens = 0;
    let bytes = 0;
    const filtroDeData = criterio.antesDe
      ? Prisma.sql`AND m."createdAt" < ${criterio.antesDe}`
      : Prisma.empty;

    for (let lote = 0; lote < MAXIMO_DE_LOTES; lote++) {
      if (
        criterio.bytesALiberar !== undefined &&
        bytes >= criterio.bytesALiberar
      )
        break;

      const linhas = await this.prisma.client.$queryRaw<
        { id: string; chave: string | null; bytes: bigint }[]
      >`
        SELECT m.id,
               m.metadata ->> 'storageKey' AS chave,
               (pg_column_size(m.*) + CASE
                  WHEN jsonb_typeof(m.metadata -> 'storageBytes') = 'number'
                  THEN (m.metadata ->> 'storageBytes')::bigint ELSE 0 END)::bigint AS bytes
        FROM messages m
        WHERE m."tenantId" = ${tenantId} ${filtroDeData}
        ORDER BY m."createdAt" ASC
        LIMIT ${LOTE}
      `;
      if (linhas.length === 0) break;

      // Com cota, só o necessário: o lote é cortado onde o espaço fecha.
      const escolhidas: typeof linhas = [];
      for (const linha of linhas) {
        if (
          criterio.bytesALiberar !== undefined &&
          bytes >= criterio.bytesALiberar
        )
          break;
        escolhidas.push(linha);
        bytes += Number(linha.bytes);
      }

      await this.prisma.client.message.deleteMany({
        where: { tenantId, id: { in: escolhidas.map((l) => l.id) } },
      });
      mensagens += escolhidas.length;

      const chaves = escolhidas
        .map((l) => l.chave)
        .filter((c): c is string => Boolean(c));
      if (chaves.length > 0) {
        // Falha no bucket não desfaz o banco: o arquivo fica órfão, mas a
        // mensagem já saiu — melhor que parar a limpeza no meio.
        await this.storage.apagarChaves(chaves).catch((erro: unknown) => {
          this.logger.warn(
            `Tenant ${tenantId}: ${chaves.length} arquivos não saíram do bucket (${String(erro)}).`,
          );
        });
      }

      if (linhas.length < LOTE) break;
    }

    return { mensagens, bytes };
  }

  /**
   * Apaga mensagens mais antigas que o prazo do tenant.
   *
   * Só mensagens: a conversa e o cliente ficam, com o histórico esvaziado.
   * Apagar a conversa inteira quebraria relatório e faria o cliente
   * parecer novo na próxima vez que escrevesse.
   */
  async purgarTenant(tenantId: string): Promise<number> {
    const settings = await this.prisma.client.retentionSettings.findFirst({
      where: { tenantId },
    });
    if (!settings?.keepMessagesDays) return 0;

    const corte = new Date();
    corte.setDate(corte.getDate() - settings.keepMessagesDays);

    const { mensagens: count } = await this.apagarMensagens(tenantId, {
      antesDe: corte,
    });
    // O histórico guardado de lado também é mensagem (ver
    // HistoricoGuardado): o bloco cuja mais nova já venceu vai inteiro.
    await this.prisma.client.historicoGuardado.deleteMany({
      where: { tenantId, maisRecenteEm: { lt: corte } },
    });

    if (count > 0) {
      this.logger.log(
        `Tenant ${tenantId}: ${count} mensagens apagadas por retenção.`,
      );
    }

    await this.prisma.client.retentionSettings.update({
      where: { id: settings.id },
      data: { lastPurgeAt: new Date(), lastPurgeDeleted: count },
    });

    return count;
  }

  /**
   * Cota cheia com a limpeza automática ligada: apaga das mais antigas pras
   * mais novas até sobrar 90% da cota — a folga evita encher de novo no dia
   * seguinte e apagar um pouquinho toda vez.
   *
   * Sem a opção ligada, nada é apagado: o painel avisa (a partir de 90%) e
   * a empresa decide. Receber mensagem nunca é bloqueado por cota — perder
   * atendimento seria pior que passar do limite.
   */
  async liberarEspaco(tenantId: string, medicao?: Medicao): Promise<number> {
    const [settings, conta] = await Promise.all([
      this.prisma.client.retentionSettings.findFirst({ where: { tenantId } }),
      this.prisma.client.billingAccount.findFirst({
        where: { tenantId },
        select: { quotaBytes: true },
      }),
    ]);
    if (!settings?.autoPurgeOnFull || !conta) return 0;

    const cota = Number(conta.quotaBytes);
    const atual = medicao ?? (await this.medir(tenantId));
    if (atual.usedBytes < cota) return 0;

    const alvo = atual.usedBytes - cota * ALVO_AO_LIBERAR;
    const { mensagens, bytes } = await this.apagarMensagens(tenantId, {
      bytesALiberar: alvo,
    });

    this.logger.log(
      `Tenant ${tenantId}: cota cheia — ${mensagens} mensagens mais antigas apagadas (~${Math.round(bytes / 1024 / 1024)} MB).`,
    );
    await this.prisma.client.retentionSettings.update({
      where: { id: settings.id },
      data: { lastPurgeAt: new Date(), lastPurgeDeleted: mensagens },
    });
    await this.medir(tenantId);
    return mensagens;
  }

  /**
   * Dá tamanho aos arquivos guardados antes de o tamanho ser gravado.
   *
   * Um pouco por passada (HEAD no bucket, um por arquivo), pra uma empresa
   * com muito histórico não segurar a varredura das outras. Arquivo que
   * não existe mais no bucket fica com zero, pra não ser perguntado de novo.
   */
  async preencherTamanhos(tenantId: string): Promise<number> {
    if (!this.storage.ligado) return 0;
    const pendentes = await this.prisma.client.$queryRaw<
      { id: string; chave: string }[]
    >`
      SELECT m.id, m.metadata ->> 'storageKey' AS chave
      FROM messages m
      WHERE m."tenantId" = ${tenantId}
        AND m.metadata ->> 'storageKey' IS NOT NULL
        AND m.metadata -> 'storageBytes' IS NULL
      LIMIT ${TAMANHOS_POR_PASSADA}
    `;
    for (const pendente of pendentes) {
      const tamanho = await this.storage
        .tamanho(pendente.chave)
        .catch(() => null);
      await this.prisma.client.$executeRaw`
        UPDATE messages
        SET metadata = jsonb_set(metadata, '{storageBytes}', to_jsonb(${tamanho ?? 0}::bigint))
        WHERE id = ${pendente.id}
      `;
    }
    return pendentes.length;
  }

  /**
   * A passada de seis em seis horas, por TODAS as empresas: completa o
   * tamanho dos arquivos antigos, aplica o prazo de guarda (quem tem),
   * mede, e libera espaço se a cota encheu (quem ligou a limpeza).
   * A medição também é o que mantém o aviso de "quase cheio" em dia.
   */
  async varrer(): Promise<{ tenants: number; deleted: number }> {
    const empresas = await this.prisma.client.tenant.findMany({
      select: { id: true },
    });

    let deleted = 0;
    for (const { id: tenantId } of empresas) {
      try {
        await this.preencherTamanhos(tenantId);
        deleted += await this.purgarTenant(tenantId);
        const medicao = await this.medir(tenantId);
        deleted += await this.liberarEspaco(tenantId, medicao);
      } catch (error) {
        // Um tenant com problema não pode parar a varredura dos outros.
        this.logger.error(
          `Falha na limpeza do tenant ${tenantId}: ${String(error)}`,
        );
      }
    }

    if (deleted > 0) {
      this.logger.log(
        `Varredura de retenção: ${deleted} mensagens apagadas em ${empresas.length} empresas.`,
      );
    }

    return { tenants: empresas.length, deleted };
  }
}
