import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Os passos que o painel da plataforma conta.
 *
 * Os de antes da conta (visita, clique, cadastro aberto) chegam do
 * navegador, anônimos; os de depois são gravados aqui dentro, onde
 * acontecem de verdade — não dá pra forjar uma assinatura mandando um
 * evento, e nada depende da tela lembrar de avisar.
 */
export type TipoDeEvento =
  | 'landing_visita'
  | 'landing_cta'
  | 'cadastro_aberto'
  | 'conta_criada'
  | 'painel_acesso'
  | 'checkout_iniciado'
  | 'assinatura_ativa'
  | 'assinatura_cancelada'
  | 'pagamento_pendente'
  | 'pacote_iniciado'
  | 'pacote_pago'
  | 'liberacao_manual'
  | 'liberacao_revogada'
  | 'conta_apagada';

/** Os que o navegador pode mandar sem estar logado. */
export const EVENTOS_DO_NAVEGADOR: TipoDeEvento[] = [
  'landing_visita',
  'landing_cta',
  'cadastro_aberto',
];

/** "2026-09-29" — pra chave que conta uma vez por dia. */
export function dia(data = new Date()): string {
  return data.toISOString().slice(0, 10);
}

/** Só os utm_* conhecidos, e curtos — vêm do navegador, sem garantia de nada. */
export function utmLimpo(utm?: Record<string, string>) {
  if (!utm) return undefined;
  const limpo: Record<string, string> = {};
  for (const chave of [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
  ]) {
    const valor = utm[chave];
    if (typeof valor === 'string' && valor) limpo[chave] = valor.slice(0, 80);
  }
  return Object.keys(limpo).length ? limpo : undefined;
}

@Injectable()
export class RegistroDeEventos {
  private readonly logger = new Logger(RegistroDeEventos.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava um passo. Nunca lança: métrica que falha não pode derrubar o
   * cadastro, o login ou o webhook do pagamento que a gerou.
   *
   * Com `chave`, o mesmo passo não entra duas vezes (o índice único
   * decide) — é o que faz "acessou o painel hoje" valer uma vez por dia.
   */
  async registrar(
    tipo: TipoDeEvento,
    quem: {
      tenantId?: string | null;
      userId?: string | null;
      visitante?: string | null;
      chave?: string;
      dados?: Prisma.InputJsonValue;
    } = {},
  ): Promise<void> {
    try {
      await this.prisma.client.eventoDaPlataforma.createMany({
        skipDuplicates: true,
        data: [
          {
            tipo,
            tenantId: quem.tenantId ?? null,
            userId: quem.userId ?? null,
            visitante: quem.visitante ?? null,
            chave: quem.chave ?? null,
            dados: quem.dados,
          },
        ],
      });
    } catch (erro) {
      this.logger.warn(
        `Não deu pra registrar o evento ${tipo}: ${erro instanceof Error ? erro.message : erro}`,
      );
    }
  }
}
