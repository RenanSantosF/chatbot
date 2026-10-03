import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  WhatsappMediaService,
  midiaIndisponivel,
} from './whatsapp-media.service';

/** De dez em dez minutos, com a primeira passada longe da subida. */
const INTERVALO_MS = 10 * 60 * 1000;
const ATRASO_INICIAL_MS = 5 * 60 * 1000;

/** Quantos arquivos por empresa a cada passada — devagar e sempre. */
const POR_PASSADA = 25;

/** Quantas linhas olhar por vez atrás das que ainda não têm cópia. */
const JANELA_DE_BUSCA = 200;

/**
 * Até onde voltar no tempo. Passado disso o WhatsApp quase nunca tem mais
 * o arquivo, e insistir é só pedido recusado.
 */
const IDADE_MAXIMA_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Só guarda enquanto o espaço da empresa tiver folga.
 *
 * Ao encher, a varredura de retenção apaga o MAIS ANTIGO pra caber o novo
 * (ver RetentionSweepService). Arquivar o passado inteiro sem freio podia
 * empurrar a conta pra esse limite — e o que seria salvo acabaria
 * apagando o texto de conversas antigas.
 */
const USO_MAXIMO = 0.7;

const TIPOS_COM_ARQUIVO = ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'] as const;

/**
 * Guarda as mídias no armazenamento próprio enquanto o WhatsApp ainda as tem.
 *
 * O que chega ao vivo já é guardado na hora (ver o webhook). O que ficava
 * de fora era o histórico — as conversas que já estavam no aparelho ao
 * conectar —, que só era guardado quando alguém abria a foto. Até lá o
 * WhatsApp podia ter apagado o arquivo, e a galeria mostrava
 * "indisponível" para algo que dava pra ter salvo.
 *
 * Reaproveita o `arquivar` do WhatsappMediaService, que já sabe pedir à
 * Evolution com o endereço certo, marcar o que sumiu de vez e anotar o
 * tamanho para a conta de espaço.
 */
@Injectable()
export class ArquivoDeMidiasService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ArquivoDeMidiasService.name);
  private timer?: NodeJS.Timeout;
  private primeira?: NodeJS.Timeout;
  private rodando = false;

  /**
   * Onde a busca parou em cada empresa: a próxima passada continua dali
   * pra trás, em vez de reler as mesmas linhas já guardadas. Ao chegar ao
   * fim, volta pro começo — e pega o que entrou nesse meio-tempo.
   */
  private readonly cursores = new Map<string, Date>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.primeira = setTimeout(() => {
      void this.arquivar();
      this.timer = setInterval(() => void this.arquivar(), INTERVALO_MS);
      this.timer.unref();
    }, ATRASO_INICIAL_MS);
    this.primeira.unref();
  }

  onModuleDestroy() {
    if (this.primeira) clearTimeout(this.primeira);
    if (this.timer) clearInterval(this.timer);
  }

  async arquivar(agora = new Date()): Promise<void> {
    if (this.rodando || !this.storage.ligado) return;
    this.rodando = true;
    try {
      const empresas = await this.prisma.client.tenant.findMany({
        where: {
          canal: 'EVOLUTION',
          status: { not: 'SUSPENDED' },
          evolutionSettings: { estado: 'CONECTADO' },
        },
        select: {
          id: true,
          billing: { select: { usedBytes: true, quotaBytes: true } },
        },
      });

      for (const empresa of empresas) {
        const cota = Number(empresa.billing?.quotaBytes ?? 0);
        const usado = Number(empresa.billing?.usedBytes ?? 0);
        if (cota > 0 && usado / cota >= USO_MAXIMO) continue;

        try {
          await this.arquivarDa(empresa.id, agora);
        } catch (erro) {
          this.logger.warn(
            `Arquivamento de mídias do tenant ${empresa.id}: ${String(erro)}`,
          );
        }
      }
    } finally {
      this.rodando = false;
    }
  }

  private async arquivarDa(tenantId: string, agora: Date) {
    const cursor = this.cursores.get(tenantId);
    const linhas = await this.prisma.client.message.findMany({
      where: {
        tenantId,
        mediaId: { not: null },
        deletedAt: null,
        messageType: { in: [...TIPOS_COM_ARQUIVO] },
        createdAt: {
          gt: new Date(agora.getTime() - IDADE_MAXIMA_MS),
          ...(cursor ? { lt: cursor } : {}),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: JANELA_DE_BUSCA,
      select: { mediaId: true, metadata: true, createdAt: true },
    });

    if (linhas.length < JANELA_DE_BUSCA) {
      this.cursores.delete(tenantId);
    }

    const pendentes = linhas.filter((linha) => {
      const metadata = (linha.metadata ?? {}) as Record<string, unknown>;
      return !metadata.storageKey && !midiaIndisponivel(metadata);
    });
    const desta = pendentes.slice(0, POR_PASSADA);

    // Continua de onde parou: depois da última linha OLHADA (se não sobrou
    // pendente pra trás dela nesta janela) ou da última arquivada agora.
    if (linhas.length === JANELA_DE_BUSCA) {
      const ultima =
        pendentes.length > POR_PASSADA
          ? desta[desta.length - 1]
          : linhas[linhas.length - 1];
      this.cursores.set(tenantId, ultima.createdAt);
    }
    if (desta.length === 0) return;

    const midias = await this.midiasDa(tenantId);
    for (const linha of desta) {
      const metadata = (linha.metadata ?? {}) as Record<string, unknown>;
      await midias.arquivar(
        linha.mediaId!,
        typeof metadata.fileName === 'string' ? metadata.fileName : undefined,
      );
    }
  }

  /**
   * O serviço de mídias como se fosse uma requisição da empresa: ele é de
   * escopo de requisição (lê o tenant do usuário logado), e esta rotina
   * roda sem requisição nenhuma.
   */
  private async midiasDa(tenantId: string): Promise<WhatsappMediaService> {
    const contexto = ContextIdFactory.create();
    this.moduleRef.registerRequestByContextId({ user: { tenantId } }, contexto);
    return this.moduleRef.resolve(WhatsappMediaService, contexto, {
      strict: false,
    });
  }
}
