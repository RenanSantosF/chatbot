import { ConversationsService, trechoEmVolta } from './conversations.service';

describe('busca no texto das mensagens', () => {
  function montar() {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'c1',
        content: 'Bom dia! Vocês fazem entrega no bairro Jardim Camburi?',
        createdAt: new Date('2026-10-01T12:00:00Z'),
        senderType: 'CUSTOMER',
        conversation: {
          customer: { name: 'Ana', phone: '5527999990000', isGroup: false },
        },
      },
    ]);
    const service = new ConversationsService(
      { tenantId: 't1', db: { message: { findMany } } } as never,
      ...(Array.from({ length: 12 }, () => ({})) as [never]),
    );
    Object.assign(service as unknown as Record<string, unknown>, {
      recorteDeVisibilidade: jest.fn().mockResolvedValue({ queueId: 'q1' }),
    });
    return { service, findMany };
  }

  it('acha pelo texto, dentro do que a pessoa pode ver', async () => {
    const { service, findMany } = montar();

    const { itens } = await service.buscarMensagens('entrega', {
      userId: 'u1',
      role: 'AGENT',
    });

    const [[{ where }]] = findMany.mock.calls as [
      [{ where: Record<string, unknown> }],
    ];
    expect(where).toMatchObject({
      content: { contains: 'entrega', mode: 'insensitive' },
      conversation: { queueId: 'q1' },
      deletedAt: null,
    });
    expect(itens[0]).toMatchObject({
      messageId: 'm1',
      conversationId: 'c1',
      cliente: 'Ana',
      daEmpresa: false,
    });
  });

  it('menos de 3 letras não busca (traria meio banco)', async () => {
    const { service, findMany } = montar();

    expect(await service.buscarMensagens('oi')).toEqual({ itens: [] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('o trecho mostra o termo, não o começo da mensagem', () => {
    const texto = `${'a'.repeat(100)} quero o boleto ${'b'.repeat(100)}`;
    const trecho = trechoEmVolta(texto, 'boleto');
    expect(trecho).toContain('boleto');
    expect(trecho.startsWith('…')).toBe(true);
    expect(trecho.endsWith('…')).toBe(true);
  });
});
