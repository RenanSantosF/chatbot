import { BadRequestException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

/**
 * "Nova conversa" abre o chat, sem pedir a primeira mensagem antes.
 *
 * Duas promessas: quem já tem conversa vê a dela (com o histórico), e
 * quem não tem ganha uma vazia — que não aparece em lista nenhuma até a
 * primeira mensagem sair.
 */
function montar(conversas: { aberta?: string; qualquer?: string } = {}) {
  const create = jest.fn().mockResolvedValue({ id: 'nova' });
  const findFirst = jest.fn(({ where }: { where: { status?: unknown } }) =>
    Promise.resolve(
      where.status
        ? conversas.aberta
          ? { id: conversas.aberta }
          : null
        : conversas.qualquer
          ? { id: conversas.qualquer }
          : null,
    ),
  );
  const prisma = {
    tenantId: 'tenant-teste',
    db: { conversation: { findFirst, create } },
  };
  const customers = {
    findOrCreateByPhone: jest.fn().mockResolvedValue({ id: 'cliente-1' }),
  };

  const service = new ConversationsService(
    prisma as never,
    customers as never,
    {} as never,
    { podeAtender: jest.fn().mockResolvedValue(false) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const getById = jest
    .spyOn(service, 'getById')
    .mockImplementation((id: string) => Promise.resolve({ id } as never));

  return { service, create, getById };
}

describe('abrir conversa sem mandar nada', () => {
  it('quem já tem conversa aberta vê a dela', async () => {
    const { service, create } = montar({ aberta: 'c-aberta' });

    const conversa = await service.abrirConversa({ phone: '5527999998888' });

    expect(conversa).toEqual({ id: 'c-aberta' });
    expect(create).not.toHaveBeenCalled();
  });

  it('sem conversa aberta, reabre a última (com o histórico)', async () => {
    const { service, create } = montar({ qualquer: 'c-antiga' });

    const conversa = await service.abrirConversa({ phone: '5527999998888' });

    expect(conversa).toEqual({ id: 'c-antiga' });
    expect(create).not.toHaveBeenCalled();
  });

  it('contato novo ganha uma conversa vazia, sem dono', async () => {
    const { service, create } = montar();

    const conversa = await service.abrirConversa({ phone: '5527999998888' });

    expect(conversa).toEqual({ id: 'nova' });
    const [[{ data }]] = create.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    expect(data).not.toHaveProperty('assignedUserId');
    expect(data.aiMode).toBe('HUMAN_ACTIVE');
  });

  it('recusa telefone sem DDI e DDD', async () => {
    const { service } = montar();

    await expect(
      service.abrirConversa({ phone: '99998888' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
