import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { UpdateInboxSettingsDto } from './dto/inbox-settings.dto';
import {
  escreverExpediente,
  lerExpediente,
  type Expediente,
} from './horario-comercial';

/**
 * Semana vazia é "não configurado", que no banco se escreve NULL.
 *
 * `Prisma.DbNull` e não `null`: em coluna Json anulável, `null` é ambíguo
 * (existe o valor JSON `null`, que é diferente de campo vazio), então o
 * Prisma exige que a intenção seja dita por extenso.
 */
function normalizar(
  entrada: Record<string, [string, string][]> | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!entrada) return Prisma.DbNull;
  const limpo = escreverExpediente(lerExpediente(entrada));
  return Object.keys(limpo).length > 0 ? limpo : Prisma.DbNull;
}

@Injectable()
export class InboxSettingsService {
  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly global: PrismaService,
  ) {}

  /**
   * A configuração já lida nesta requisição.
   *
   * Ela é consultada VÁRIAS vezes no mesmo pedido: responder uma mensagem
   * passa por aqui pra saber se assina com o nome de quem respondeu, se
   * reabre a conversa encerrada, se manda confirmação de leitura e se avisa
   * ao resolver — quatro idas ao banco pela mesma linha, que não muda no
   * meio de uma requisição.
   *
   * O serviço é de escopo de requisição (depende do TenantPrismaService),
   * então este cache nasce e morre com o pedido: não há como servir a
   * configuração de uma empresa pra outra, nem entregar valor velho depois
   * de alguém salvar a tela de Atendimento.
   */
  private emCache?: Promise<Awaited<ReturnType<typeof this.buscar>>>;

  /**
   * Cria com os padrões na primeira leitura em vez de semear no registro do
   * tenant: assim empresas criadas antes desta tela existirem também
   * ganham a configuração sem migração de dados.
   */
  private async buscar() {
    const existing = await this.prisma.db.inboxSettings.findFirst();
    if (existing) return existing;
    return this.prisma.db.inboxSettings.create({
      data: { tenantId: this.prisma.tenantId },
    });
  }

  /**
   * A configuração mais o fuso da empresa.
   *
   * O fuso vive no Tenant, não aqui, mas quem lê o expediente sempre
   * precisa dos dois juntos: uma faixa "08:00 às 18:00" não significa nada
   * sem saber de quem é o relógio. Mandar separado obrigaria o painel a
   * uma segunda requisição pra montar uma informação só.
   */
  async paraOPainel() {
    const [config, tenant] = await Promise.all([
      this.get(),
      this.global.client.tenant.findUniqueOrThrow({
        where: { id: this.prisma.tenantId },
        select: { timezone: true },
      }),
    ]);

    return { ...config, timezone: tenant.timezone };
  }

  get() {
    // A PROMESSA é guardada, não o resultado: duas leituras disparadas no
    // mesmo instante (o `Promise.all` do envio faz isso) compartilham a
    // mesma consulta em vez de criarem duas linhas na corrida do primeiro
    // acesso.
    this.emCache ??= this.buscar();
    return this.emCache;
  }

  /**
   * O expediente já lido e validado.
   *
   * Quem precisa do horário nunca deve tocar na coluna Json direto: ela não
   * tem garantia de forma, e a conferência tem que morar num lugar só.
   */
  async expediente(): Promise<Expediente> {
    const settings = await this.get();
    return lerExpediente(settings.businessHours);
  }

  async update(dto: UpdateInboxSettingsDto) {
    const current = await this.get();
    // O expediente sai do resto por tipo, e não só por gosto: o Prisma quer
    // `DbNull` onde o DTO fala `null`, então os dois não cabem no mesmo
    // espalhamento.
    const { businessHours, ...resto } = dto;

    const atualizada = await this.prisma.db.inboxSettings.update({
      where: { id: current.id },
      data: {
        ...resto,
        // Normalizado na entrada: as faixas chegam ordenadas e sem faixa
        // inválida, e uma semana inteira sem atendimento nenhum vira NULL —
        // o mesmo estado de quem nunca configurou. Sem isto, um `{}`
        // gravado ficaria indistinguível de "configurado e sempre fechado".
        ...(businessHours !== undefined
          ? { businessHours: normalizar(businessHours) }
          : {}),
      },
    });
    // Quem escreveu não pode continuar lendo o de antes no resto do pedido.
    this.emCache = Promise.resolve(atualizada);
    return atualizada;
  }
}
