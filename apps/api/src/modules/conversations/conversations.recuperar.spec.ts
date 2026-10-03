import { ConversationsService } from './conversations.service';

/**
 * O relato: mensagens escritas pelo celular não apareceram no painel, e
 * "sincronizar" não as trouxe — sincronizar só relia o nosso banco. A
 * Evolution guarda cada mensagem; é de lá que vem o que faltou.
 */
const TELEFONE = '5527996255918';
const JID = `${TELEFONE}@s.whatsapp.net`;

function guardada(id: string, fromMe: boolean, texto: string, iso: string) {
  return {
    key: { remoteJid: JID, fromMe, id },
    pushName: fromMe ? 'Você' : 'Floriza',
    message: { conversation: texto },
    messageTimestamp: Math.floor(new Date(iso).getTime() / 1000),
  };
}

let sequencia = 0;

function montar(opcoes: {
  guardadas: Record<string, unknown>[] | null;
  existentes?: string[];
  maisAntiga?: string | null;
}) {
  const id = `conversa-${(sequencia += 1)}`;
  const conversa = {
    id,
    channel: 'WHATSAPP',
    lastMessageAt: new Date('2026-10-03T21:28:00Z'),
    customer: { phone: TELEFONE, isGroup: false },
  };
  const criadas: Record<string, unknown>[] = [];
  const prisma = {
    tenantId: 'tenant-1',
    db: {
      conversation: {
        findFirst: jest.fn().mockResolvedValue(conversa),
        update: jest.fn().mockResolvedValue({ ...conversa, messages: [] }),
      },
      message: {
        findFirst: jest.fn().mockResolvedValue(
          opcoes.maisAntiga === null
            ? null
            : {
                createdAt: new Date(
                  opcoes.maisAntiga ?? '2026-10-03T16:00:00Z',
                ),
              },
        ),
        findMany: jest
          .fn()
          .mockResolvedValue(
            (opcoes.existentes ?? []).map((externo) => ({
              externalId: externo,
            })),
          ),
        createMany: jest.fn((args: { data: Record<string, unknown>[] }) => {
          criadas.push(...args.data);
          return { count: args.data.length };
        }),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };
  const whatsapp = {
    mensagensGuardadas: jest.fn().mockResolvedValue(opcoes.guardadas),
  };
  const service = new ConversationsService(
    prisma as never,
    {} as never,
    { emitToUsers: jest.fn(), emitToTenant: jest.fn() } as never,
    {} as never,
    whatsapp as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  Object.assign(service as unknown as Record<string, unknown>, {
    recorteDeVisibilidade: jest.fn().mockResolvedValue({}),
    emitirParaConversa: jest.fn(),
  });
  return { service, criadas, whatsapp, id };
}

describe('recuperar do WhatsApp o que faltou', () => {
  it('traz as mensagens do celular que nunca chegaram ao painel', async () => {
    const { service, criadas, id } = montar({
      guardadas: [
        guardada(
          'B',
          true,
          'Você tá precisando do que?',
          '2026-10-03T21:26:30Z',
        ),
        guardada('A', true, 'Ignora kkk', '2026-10-03T21:26:00Z'),
        guardada('C', false, 'Kkk', '2026-10-03T21:28:00Z'),
      ],
      // A do cliente já estava aqui.
      existentes: [`${JID}|0|C`],
    });

    const { recuperadas } = await service.recuperarDoWhatsapp(id);

    expect(recuperadas).toBe(2);
    expect(criadas.map((m) => m.content).sort()).toEqual([
      'Ignora kkk',
      'Você tá precisando do que?',
    ]);
    expect(criadas[0]).toMatchObject({
      senderType: 'AGENT',
      conversationId: id,
      status: 'SENT',
    });
    // Com a hora em que foi escrita, não a de agora.
    expect(criadas.find((m) => m.content === 'Ignora kkk')?.createdAt).toEqual(
      new Date('2026-10-03T21:26:00Z'),
    );
  });

  it('reconhece o que já está aqui pelo id da mensagem, mesmo com outra grafia', async () => {
    const { service, criadas, id } = montar({
      guardadas: [guardada('A', true, 'Oi', '2026-10-03T21:26:00Z')],
      existentes: ['123456@lid|1|A'],
    });

    await service.recuperarDoWhatsapp(id);

    expect(criadas).toHaveLength(0);
  });

  it('não traz o passado distante: só preenche buracos', async () => {
    const { service, criadas, id } = montar({
      guardadas: [guardada('VELHA', false, 'oi', '2026-09-01T10:00:00Z')],
      maisAntiga: '2026-10-01T00:00:00Z',
    });

    await service.recuperarDoWhatsapp(id);

    expect(criadas).toHaveLength(0);
  });

  it('uma conferência por minuto: abrir de novo não pergunta outra vez', async () => {
    const { service, whatsapp, id } = montar({ guardadas: [] });

    await service.recuperarDoWhatsapp(id);
    await service.recuperarDoWhatsapp(id);

    expect(whatsapp.mensagensGuardadas).toHaveBeenCalledTimes(1);
  });

  it('servidor fora do ar: segue sem recuperar, sem erro', async () => {
    const { service, id } = montar({ guardadas: null });

    await expect(service.recuperarDoWhatsapp(id)).resolves.toEqual({
      recuperadas: 0,
    });
  });
});
