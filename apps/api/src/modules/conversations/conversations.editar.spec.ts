import { BadRequestException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

/**
 * Editar, apagar para todos e apagar a conversa.
 *
 * As duas primeiras mexem no aparelho do CLIENTE — então o WhatsApp tem
 * que aceitar antes de o painel mudar. Se ele recusar, nada muda aqui.
 */
const AGORA = new Date('2026-10-01T12:00:00Z');
const minutosAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000);

function montar(
  mensagem: Record<string, unknown> = {},
  recusa: string | null = null,
) {
  const base = {
    id: 'm1',
    conversationId: 'c1',
    senderType: 'AGENT',
    senderId: 'u1',
    messageType: 'TEXT',
    content: 'Oi, tudo bem?',
    externalId: '5511999@s.whatsapp.net|1|ABC',
    deletedAt: null,
    metadata: null,
    createdAt: minutosAtras(5),
    ...mensagem,
  };
  const update = jest.fn(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...base, ...data }),
  );
  const prisma = {
    tenantId: 't1',
    db: {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'c1',
          queueId: null,
          assignedUserId: null,
          customer: { phone: '5511999', name: 'Ana' },
        }),
        delete: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]),
      },
      message: {
        findFirst: jest.fn().mockResolvedValue(base),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { metadata: { storageKey: 't1/foto.jpg' } },
            { metadata: {} },
          ]),
        update,
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      historicoGuardado: { deleteMany: jest.fn().mockResolvedValue({}) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };
  const whatsapp = {
    editarMensagem: jest.fn().mockResolvedValue(recusa),
    apagarParaTodos: jest.fn().mockResolvedValue(recusa),
  };
  const media = { apagarArquivos: jest.fn().mockResolvedValue(undefined) };
  const realtime = { emitToTenant: jest.fn(), emitToUsers: jest.fn() };
  const audit = { registrar: jest.fn() };

  const service = new ConversationsService(
    prisma as never,
    {} as never,
    realtime as never,
    {} as never,
    whatsapp as never,
    media as never,
    { get: jest.fn().mockResolvedValue({ queueVisibility: 'ALL' }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never,
    {} as never,
  );
  return { service, prisma, whatsapp, update, media, realtime };
}

const DONO = { userId: 'u1', role: 'AGENT' as const };

describe('editar mensagem', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(AGORA));
  afterEach(() => jest.useRealTimers());

  it('edita no WhatsApp e depois no painel, com a marca de editada', async () => {
    const { service, whatsapp, update } = montar();

    await service.editarMensagem('c1', 'm1', 'Oi, tudo certo?', DONO);

    expect(whatsapp.editarMensagem).toHaveBeenCalledWith(
      '5511999',
      '5511999@s.whatsapp.net|1|ABC',
      'Oi, tudo certo?',
    );
    const [[{ data }]] = update.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    expect(data.content).toBe('Oi, tudo certo?');
    expect(data.metadata).toMatchObject({
      editadaEm: expect.any(String) as string,
    });
  });

  it('depois de 15 minutos, recusa sem nem perguntar ao WhatsApp', async () => {
    const { service, whatsapp } = montar({ createdAt: minutosAtras(16) });

    await expect(
      service.editarMensagem('c1', 'm1', 'novo', DONO),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(whatsapp.editarMensagem).not.toHaveBeenCalled();
  });

  it('WhatsApp recusou: o painel não muda', async () => {
    const { service, update } = montar({}, 'Message not found');

    await expect(
      service.editarMensagem('c1', 'm1', 'novo', DONO),
    ).rejects.toThrow('Message not found');
    expect(update).not.toHaveBeenCalled();
  });

  it('mensagem do cliente não se edita', async () => {
    const { service } = montar({ senderType: 'CUSTOMER', senderId: null });

    await expect(
      service.editarMensagem('c1', 'm1', 'novo', DONO),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('apagar para todos', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(AGORA));
  afterEach(() => jest.useRealTimers());

  it('WhatsApp recusou: não apaga nem do painel', async () => {
    const { service, update } = montar({}, 'recusado');

    await expect(service.apagarParaTodos('c1', 'm1', DONO)).rejects.toThrow(
      'recusado',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('passou de dois dias: recusa e sugere apagar só do painel', async () => {
    const { service, whatsapp } = montar({
      createdAt: minutosAtras(49 * 60),
    });

    await expect(service.apagarParaTodos('c1', 'm1', DONO)).rejects.toThrow(
      /só do painel/,
    );
    expect(whatsapp.apagarParaTodos).not.toHaveBeenCalled();
  });
});

describe('apagar a conversa', () => {
  it('apaga mensagens, anexos guardados e avisa as telas', async () => {
    const { service, prisma, media, realtime } = montar();

    await service.apagarConversa('c1', { ...DONO, role: 'OWNER' });

    expect(prisma.db.message.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 'c1' },
    });
    expect(prisma.db.conversation.delete).toHaveBeenCalledWith({
      where: { id: 'c1' },
    });
    expect(media.apagarArquivos).toHaveBeenCalledWith(['t1/foto.jpg']);
    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      't1',
      'conversation.deleted',
      { conversationId: 'c1' },
    );
  });
});
