import { NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

/**
 * A listagem já tinha o recorte por setor (`recorteDeVisibilidade`); o que
 * faltava era aplicar o MESMO recorte em cada operação que lê ou muda uma
 * conversa pelo id direto — abrir, mandar mensagem, atribuir, transferir,
 * resolver, reabrir, marcar como lida, reagir, encaminhar. Sem isso, a
 * listagem era só vitrine: quem soubesse ou adivinhasse um id de outro
 * setor continuava lendo e mexendo nele por fora da lista.
 *
 * `user-fora` não é membro de nenhum setor da conversa-alvo e não é o
 * responsável por ela — é exatamente quem deveria ver "não encontrada".
 * `user-dentro` é membro do mesmo setor — para provar que o recorte não
 * é uma trava geral, só direcionada.
 */

const CONVERSA_ALVO = {
  id: 'conversa-alvo',
  queueId: 'setor-financeiro',
  assignedUserId: null as string | null,
};

const CONVERSA_DE_FORA_PROPRIA = {
  id: 'conversa-minha',
  queueId: null as string | null,
  assignedUserId: 'user-fora',
};

type ConversaFixa = {
  id: string;
  queueId: string | null;
  assignedUserId: string | null;
};

function correspondeAoRecorte(
  where: Record<string, unknown>,
  conversa: ConversaFixa,
) {
  if (where.id !== conversa.id) return false;
  const or = where.OR as Record<string, unknown>[] | undefined;
  if (!or) return true; // sem OR = dono/admin, ou visibilidade ALL
  return or.some((condicao) => {
    if ('queueId' in condicao) {
      const q = condicao.queueId as null | { in: (string | null)[] };
      if (q === null) return conversa.queueId === null;
      if (q && typeof q === 'object' && 'in' in q)
        return q.in.includes(conversa.queueId);
    }
    if ('assignedUserId' in condicao) {
      return conversa.assignedUserId === condicao.assignedUserId;
    }
    return false;
  });
}

function montar() {
  const conversas: ConversaFixa[] = [CONVERSA_ALVO, CONVERSA_DE_FORA_PROPRIA];

  const acharConversa = (where: Record<string, unknown>) =>
    conversas.find((c) => correspondeAoRecorte(where, c)) ?? null;

  const mensagens: Record<string, { id: string; conversationId: string }> = {
    'msg-alvo': { id: 'msg-alvo', conversationId: 'conversa-alvo' },
    'msg-minha': { id: 'msg-minha', conversationId: 'conversa-minha' },
  };

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findFirst: jest.fn((args: { where: Record<string, unknown> }) =>
          Promise.resolve(
            acharConversa(args.where)
              ? {
                  ...acharConversa(args.where),
                  messages: [],
                  tags: [],
                  customer: {},
                }
              : null,
          ),
        ),
        update: jest.fn().mockResolvedValue({
          id: 'conversa-alvo',
          messages: [],
          tags: [],
          customer: {},
        }),
      },
      message: {
        findFirst: jest.fn((args: { where: { id: string } }) =>
          Promise.resolve(mensagens[args.where.id] ?? null),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'msg-nova' }),
        update: jest.fn().mockResolvedValue({ id: 'msg-alvo' }),
      },
      queueMember: {
        findMany: jest.fn((args: { where: { userId: string } }) =>
          Promise.resolve(
            args.where.userId === 'user-dentro'
              ? [{ queueId: 'setor-financeiro' }]
              : [],
          ),
        ),
      },
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'outro-user', name: 'Outro' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      queue: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'setor-financeiro', name: 'Financeiro' }),
      },
    },
  };

  const inboxSettings = {
    get: jest.fn().mockResolvedValue({
      queueVisibility: 'RESTRITA',
      notifyOnResolve: false,
      resolveMessage: '',
      sendReadReceipts: false,
    }),
  };

  const service = new ConversationsService(
    prisma as never,
    {} as never,
    { emitToTenant: jest.fn() } as never,
    { diagnostico: jest.fn().mockResolvedValue({ pode: true }) } as never,
    {} as never,
    {} as never,
    inboxSettings as never,
    {} as never,
    {} as never,
    { marcar: jest.fn(), desmarcar: jest.fn() } as never,
    { transcreverSeAutomatico: jest.fn() } as never,
    { registrar: jest.fn() } as never,
    { avisarEquipe: jest.fn().mockResolvedValue(undefined) } as never,
  );

  return { service, prisma };
}

const FORA = { userId: 'user-fora', role: 'AGENT' as const };
const DENTRO = { userId: 'user-dentro', role: 'AGENT' as const };
const DONO = { userId: 'user-dono', role: 'OWNER' as const };

describe('recorte de visibilidade fora da listagem', () => {
  it('getById nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(service.getById('conversa-alvo', FORA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('getById deixa passar quem é do setor', async () => {
    const { service } = montar();
    const conversa = await service.getById('conversa-alvo', DENTRO);
    expect(conversa.id).toBe('conversa-alvo');
  });

  it('getById deixa passar dono, de qualquer setor', async () => {
    const { service } = montar();
    const conversa = await service.getById('conversa-alvo', DONO);
    expect(conversa.id).toBe('conversa-alvo');
  });

  it('listMessages nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.listMessages('conversa-alvo', {}, FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('setPriority nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.setPriority('conversa-alvo', 'URGENT', FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('setPriority funciona pra quem é do setor', async () => {
    const { service } = montar();
    await expect(
      service.setPriority('conversa-alvo', 'URGENT', DENTRO),
    ).resolves.toBeDefined();
  });

  it('sendAgentMessage nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.sendAgentMessage(
        'conversa-alvo',
        'user-fora',
        'oi',
        undefined,
        FORA,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('apagarMensagem nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.apagarMensagem('conversa-alvo', 'msg-alvo', {
        userId: FORA.userId,
        role: FORA.role,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('forwardMessage nega quando o DESTINO é de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.forwardMessage('msg-minha', 'conversa-alvo', 'user-fora', FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('forwardMessage nega quando a ORIGEM é de outro setor — a porta lateral de leitura', async () => {
    const { service } = montar();
    await expect(
      service.forwardMessage('msg-alvo', 'conversa-minha', 'user-fora', FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marcarEtiqueta nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.marcarEtiqueta('conversa-alvo', 'tag-1', FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('desmarcarEtiqueta nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.desmarcarEtiqueta('conversa-alvo', 'tag-1', FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assign nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.assign('conversa-alvo', 'user-fora', { role: 'AGENT' }, FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assign funciona pra quem é do setor', async () => {
    const { service } = montar();
    await expect(
      service.assign('conversa-alvo', 'user-dentro', { role: 'AGENT' }, DENTRO),
    ).resolves.toBeDefined();
  });

  it('transferTo nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.transferTo('conversa-alvo', 'outro-user', 'user-fora', FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('transferToQueue nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.transferToQueue(
        'conversa-alvo',
        'setor-financeiro',
        'user-fora',
        FORA,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('acceptAssignment nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.acceptAssignment('conversa-alvo', 'user-fora', FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('declineAssignment nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.declineAssignment('conversa-alvo', 'user-fora', undefined, FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolve nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(service.resolve('conversa-alvo', FORA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resolve funciona pra quem é do setor', async () => {
    const { service } = montar();
    await expect(
      service.resolve('conversa-alvo', DENTRO),
    ).resolves.toBeDefined();
  });

  it('reopen nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(service.reopen('conversa-alvo', FORA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('setAiMode nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.setAiMode('conversa-alvo', 'AI_ACTIVE', FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marcarComoLida nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.marcarComoLida('conversa-alvo', FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reactToMessage nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.reactToMessage('conversa-alvo', 'msg-alvo', '👍', FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('garantirConversaVisivel (usado pela transcrição) nega uma conversa de outro setor', async () => {
    const { service } = montar();
    await expect(
      service.garantirConversaVisivel('conversa-alvo', FORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sem viewer nenhum (chamada de sistema), continua vendo tudo', async () => {
    const { service } = montar();
    const conversa = await service.getById('conversa-alvo');
    expect(conversa.id).toBe('conversa-alvo');
  });
});
