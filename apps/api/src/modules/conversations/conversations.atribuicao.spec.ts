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
    { transcreverSeAutomatico: jest.fn() } as never,
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

/**
 * Quem responde, assume.
 *
 * A conversa que ninguém pegou não pode continuar "livre" depois que
 * alguém já falou com o cliente: ela segue aparecendo como disponível, um
 * colega responde por cima, e o cliente recebe duas versões da mesma coisa.
 *
 * O caso da indicação pendente é o que veio do uso real. O painel mostrava
 * "Responsável: Lucas" logo depois de a conversa ser encaminhada — sem que
 * o Lucas tivesse aberto a tela. Se outra pessoa responde nesse meio-tempo,
 * é ELA que está atendendo, e a indicação virou passado.
 */
function servicoDeResposta(
  antes: {
    assignedUserId: string | null;
    assignmentAccepted?: boolean;
    aiMode?: string;
    status?: string;
  },
) {
  const escritas: Record<string, unknown>[] = [];
  const notas: string[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findFirst: jest
          .fn()
          .mockImplementation((args: { select?: Record<string, unknown> }) => {
            // reabrirSePreciso lê só o status; assumirAoResponder lê a
            // atribuição; persistMessage lê status e aiMode juntos.
            if (args?.select && 'assignedUserId' in args.select) {
              return {
                assignmentAccepted: true,
                aiMode: 'HUMAN_ACTIVE',
                ...antes,
              };
            }
            return { status: antes.status ?? 'OPEN', aiMode: 'HUMAN_ACTIVE' };
          }),
        update: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) => {
            escritas.push(args.data);
            return {
              id: 'conversa-1',
              channel: 'INTERNAL',
              customer: { id: 'cliente-1', phone: '5511999990000' },
              assignedUser: { id: 'user-renan', name: 'Renan Ferreira' },
              messages: [],
            };
          }),
      },
      message: {
        create: jest
          .fn()
          .mockImplementation((args: { data: { content: string } }) => {
            notas.push(args.data.content);
            return {
              id: 'msg-1',
              createdAt: new Date('2026-08-14T13:05:00Z'),
              ...args.data,
            };
          }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ name: 'Renan' }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'user-renan', name: 'Renan Ferreira' },
        ]),
      },
    },
  };

  const service = new ConversationsService(
    prisma as never,
    {} as never,
    { emitToTenant: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    { get: jest.fn().mockResolvedValue({ allowSendWhenResolved: true }) } as never,
    {} as never,
    {} as never,
    {} as never,
    { transcreverSeAutomatico: jest.fn() } as never,
  );

  return { service, escritas, notas };
}

const responder = (service: ConversationsService) =>
  service.sendAgentMessage('conversa-1', 'user-renan', 'Bom dia!');

describe('responder assume a conversa', () => {
  it('conversa sem dono passa a ser de quem respondeu', async () => {
    const { service, escritas } = servicoDeResposta({ assignedUserId: null });

    await responder(service);

    expect(escritas[0]).toMatchObject({
      assignedUserId: 'user-renan',
      assignmentAccepted: true,
    });
  });

  it('indicação sem aceite não segura a conversa', async () => {
    // O defeito relatado: encaminhada pro Lucas, que nunca aceitou. Quem
    // respondeu foi o Renan, e o painel continuava dizendo Lucas.
    const { service, escritas } = servicoDeResposta({
      assignedUserId: 'user-lucas',
      assignmentAccepted: false,
    });

    await responder(service);

    expect(escritas[0]).toMatchObject({
      assignedUserId: 'user-renan',
      assignmentAccepted: true,
    });
  });

  it('a nota diz que a indicação foi superada', async () => {
    const { service, notas } = servicoDeResposta({
      assignedUserId: 'user-lucas',
      assignmentAccepted: false,
    });

    await responder(service);

    expect(notas[0]).toContain('sem aceite');
  });

  it('dono que ACEITOU não é trocado por quem respondeu', async () => {
    // Aqui a troca tem que passar pelo "Assumir", que pede confirmação e
    // registra a mudança — responder por cima de um colega que está no
    // caso não pode acontecer em silêncio.
    const { service, escritas } = servicoDeResposta({
      assignedUserId: 'user-lucas',
      assignmentAccepted: true,
    });

    await responder(service);

    expect(escritas[0]).not.toMatchObject({ assignedUserId: 'user-renan' });
  });

  it('quem já era o indicado só confirma, sem virar "tomada"', async () => {
    // O próprio indicado respondendo é o aceite acontecendo na prática.
    const { service, escritas, notas } = servicoDeResposta({
      assignedUserId: 'user-renan',
      assignmentAccepted: false,
    });

    await responder(service);

    expect(escritas[0]).not.toMatchObject({ assignedUserId: 'user-renan' });
    expect(notas.join(' ')).not.toContain('sem aceite');
  });

  it('a IA se cala quando uma pessoa responde', async () => {
    // Com a IA ativa, a próxima mensagem do cliente seria respondida pelos
    // dois — do mesmo número, possivelmente com respostas diferentes.
    const { service, escritas } = servicoDeResposta({
      assignedUserId: 'user-renan',
      assignmentAccepted: true,
      aiMode: 'AI_ACTIVE',
    });

    await responder(service);

    expect(escritas[0]).toMatchObject({ aiMode: 'HUMAN_ACTIVE' });
  });
});
