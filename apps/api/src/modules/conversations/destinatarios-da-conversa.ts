import type { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

/**
 * A mesma regra de `ConversationsService.recorteDeVisibilidade`, só que
 * devolvendo QUEM em vez de um filtro pro Prisma.
 *
 * A lista e a abertura por id pedem ao banco "me dê as conversas onde WHERE
 * bate"; tempo real e push são o oposto — o servidor já decidiu O QUE
 * aconteceu, e agora precisa saber EM QUEM entregar. Sem isto, o aviso saía
 * pra empresa inteira, e quem tinha acesso restrito recebia no soquete e no
 * celular o conteúdo de uma conversa que a lista e a abertura por id já
 * escondiam dele — a tela calada não impedia o aviso de aparecer.
 *
 * É função solta, não método de `ConversationsService`, porque também é
 * chamada por `TranscricaoService` — que já é dependência DELE (injetar de
 * volta criaria ciclo). `queueVisibility` entra como parâmetro (e não é
 * lido aqui do banco) porque cada chamador já tem seu próprio jeito de
 * pegá-la sem duplicar a regra de "linha ainda não existe = ALL, que é o
 * padrão da coluna" — ver `InboxSettingsService.get()`.
 */
export async function destinatariosDaConversa(
  prisma: TenantPrismaService,
  conversation: { queueId: string | null; assignedUserId: string | null },
  queueVisibility: string,
): Promise<string[]> {
  const usuarios = await prisma.db.user.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, role: true },
  });

  if (queueVisibility === 'ALL' || !conversation.queueId) {
    return usuarios.map((u) => u.id);
  }

  const membros = await prisma.db.queueMember.findMany({
    where: { queueId: conversation.queueId },
    select: { userId: true },
  });
  const doSetor = new Set(membros.map((m) => m.userId));

  return usuarios
    .filter(
      (u) =>
        u.role === 'OWNER' ||
        u.role === 'ADMIN' ||
        doSetor.has(u.id) ||
        u.id === conversation.assignedUserId,
    )
    .map((u) => u.id);
}
