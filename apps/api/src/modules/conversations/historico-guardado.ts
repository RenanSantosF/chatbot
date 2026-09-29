import type { MessageType, Prisma } from '../../../generated/prisma/client';
import type { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { mediaIdDe } from './media-id';

/** Uma mensagem do histórico do aparelho, como `importarHistorico` recebe. */
export interface MensagemDoHistorico {
  daEmpresa: boolean;
  content: string;
  messageType?: MessageType;
  metadata?: Prisma.InputJsonValue;
  externalId?: string;
  createdAt: Date;
}

/** O bloco guardado de volta em objetos — as datas viajam como texto no JSON. */
export function lerGuardadas(bruto: Prisma.JsonValue): MensagemDoHistorico[] {
  if (!Array.isArray(bruto)) return [];
  const lidas: MensagemDoHistorico[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const m = item as Record<string, unknown>;
    const createdAt = new Date(String(m.createdAt));
    if (Number.isNaN(createdAt.getTime()) || typeof m.content !== 'string') {
      continue;
    }
    lidas.push({
      daEmpresa: m.daEmpresa === true,
      content: m.content,
      messageType: (m.messageType as MessageType | undefined) ?? undefined,
      metadata: (m.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      externalId: typeof m.externalId === 'string' ? m.externalId : undefined,
      createdAt,
    });
  }
  return lidas;
}

export function paraGuardar(
  mensagens: MensagemDoHistorico[],
): Prisma.InputJsonValue {
  return mensagens.map((m) => ({
    daEmpresa: m.daEmpresa,
    content: m.content,
    ...(m.messageType ? { messageType: m.messageType } : {}),
    ...(m.metadata !== undefined ? { metadata: m.metadata } : {}),
    ...(m.externalId ? { externalId: m.externalId } : {}),
    createdAt: m.createdAt.toISOString(),
  }));
}

/** A linha da tabela de mensagens de uma mensagem do histórico. */
export function linhaDoHistorico(
  tenantId: string,
  conversationId: string,
  m: MensagemDoHistorico,
) {
  return {
    tenantId,
    conversationId,
    senderType: m.daEmpresa ? ('AGENT' as const) : ('CUSTOMER' as const),
    content: m.content,
    messageType: m.messageType ?? ('TEXT' as const),
    metadata: m.metadata,
    mediaId: mediaIdDe(m.metadata),
    externalId: m.externalId,
    // Já entregue: quem entregou foi o WhatsApp do celular, semanas atrás.
    status: 'SENT' as const,
    createdAt: m.createdAt,
  };
}

/**
 * Transforma o histórico guardado de uma conversa em mensagens de verdade.
 *
 * Chamado por quem vai LER a conversa: a primeira página do painel e o
 * contexto da IA. Devolve quantas mensagens entraram — zero é o caso
 * comum (conversa sem nada guardado), e custa uma leitura pela chave.
 *
 * Duas abas abrindo a mesma conversa no mesmo segundo gravam as duas:
 * `skipDuplicates` (o índice único do id externo) decide. A linha só é
 * apagada se continua a mesma que foi lida — um lote do aparelho que a
 * atualizou no meio do caminho não se perde.
 */
export async function abrirHistoricoGuardado(
  prisma: Pick<TenantPrismaService, 'db' | 'tenantId'>,
  conversationId: string,
): Promise<number> {
  const guardado = await prisma.db.historicoGuardado.findUnique({
    where: { conversationId },
    select: { mensagens: true, updatedAt: true },
  });
  if (!guardado) return 0;

  const mensagens = lerGuardadas(guardado.mensagens);
  const gravadas = mensagens.length
    ? await prisma.db.message.createMany({
        skipDuplicates: true,
        data: mensagens.map((m) =>
          linhaDoHistorico(prisma.tenantId, conversationId, m),
        ),
      })
    : { count: 0 };

  await prisma.db.historicoGuardado.deleteMany({
    where: { conversationId, updatedAt: guardado.updatedAt },
  });

  return gravadas.count;
}
