import { ConflictException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

/**
 * Quem pode tomar pra si uma conversa que já tem dono.
 *
 * A regra tem que valer nos dois sentidos: atendente é barrado até
 * confirmar (senão dois respondem o mesmo cliente), e dono/admin passam
 * direto (senão um colega de férias deixa cliente sem atendimento). É fácil
 * corrigir um lado e quebrar o outro — daí o teste cobrir os dois.
 */
function servicoCom(conversaAtual: Record<string, unknown>) {
  const atualizada = {
    ...conversaAtual,
    assignedUser: { id: 'user-novo', name: 'Bruno' },
    messages: [],
  };

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findFirst: jest.fn().mockResolvedValue(conversaAtual),
        update: jest.fn().mockResolvedValue(atualizada),
      },
      message: { create: jest.fn().mockResolvedValue({}) },
    },
  };

  const realtime = { emitToTenant: jest.fn() };

  const service = new ConversationsService(
    prisma as never,
    {} as never,
    realtime as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, prisma, realtime };
}

const conversaDeOutraPessoa = {
  id: 'conversa-1',
  assignedUserId: 'user-ana',
  assignmentAccepted: true,
  assignedUser: { id: 'user-ana', name: 'Ana' },
  customer: { id: 'cliente-1', phone: '5511999990000' },
};

describe('assumir conversa', () => {
  it('barra o atendente e diz de quem é a conversa', async () => {
    const { service, prisma } = servicoCom(conversaDeOutraPessoa);

    await expect(
      service.assign('conversa-1', 'user-novo', { role: 'AGENT' }),
    ).rejects.toBeInstanceOf(ConflictException);

    // O ponto: nada mudou no banco. Um erro que já tivesse trocado o dono
    // seria pior que nenhum erro.
    expect(prisma.db.conversation.update).not.toHaveBeenCalled();
  });

  it('cita o nome de quem está atendendo, pra confirmação fazer sentido', async () => {
    const { service } = servicoCom(conversaDeOutraPessoa);

    await expect(
      service.assign('conversa-1', 'user-novo', { role: 'AGENT' }),
    ).rejects.toThrow(/Ana/);
  });

  it('deixa passar quando o atendente confirma', async () => {
    const { service, prisma } = servicoCom(conversaDeOutraPessoa);

    await service.assign('conversa-1', 'user-novo', {
      role: 'AGENT',
      force: true,
    });

    expect(prisma.db.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignedUserId: 'user-novo',
        }) as object,
      }) as object,
    );
  });

  it.each(['OWNER', 'ADMIN'] as const)(
    '%s redistribui sem confirmar — é o trabalho dele',
    async (role) => {
      const { service, prisma } = servicoCom(conversaDeOutraPessoa);

      await service.assign('conversa-1', 'user-novo', { role });

      expect(prisma.db.conversation.update).toHaveBeenCalled();
    },
  );

  it('registra no histórico de quem a conversa saiu', async () => {
    const { service, prisma } = servicoCom(conversaDeOutraPessoa);

    await service.assign('conversa-1', 'user-novo', { role: 'OWNER' });

    expect(prisma.db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          senderType: 'SYSTEM',
          // Quem entrou e quem saiu, os dois na mesma linha: é o que
          // permite reconstruir depois por que a conversa mudou de mão.
          content: expect.stringMatching(/Bruno.*Ana/) as unknown,
        }) as object,
      }) as object,
    );
  });

  it('conversa sem dono é assumida direto, sem confirmação', async () => {
    const { service, prisma } = servicoCom({
      ...conversaDeOutraPessoa,
      assignedUserId: null,
      assignedUser: null,
    });

    await service.assign('conversa-1', 'user-novo', { role: 'AGENT' });

    expect(prisma.db.conversation.update).toHaveBeenCalled();
  });

  it('indicação ainda não aceita não conta como dono — não exige confirmação', async () => {
    // Uma indicação pendente é uma sugestão do sistema, não uma pessoa
    // atendendo. Tratá-la como dono faria a conversa ficar presa em quem
    // nunca aceitou.
    const { service, prisma } = servicoCom({
      ...conversaDeOutraPessoa,
      assignmentAccepted: false,
    });

    await service.assign('conversa-1', 'user-novo', { role: 'AGENT' });

    expect(prisma.db.conversation.update).toHaveBeenCalled();
  });

  it('assumir a própria conversa não pede confirmação', async () => {
    const { service, prisma } = servicoCom(conversaDeOutraPessoa);

    await service.assign('conversa-1', 'user-ana', { role: 'AGENT' });

    expect(prisma.db.conversation.update).toHaveBeenCalled();
  });
});
