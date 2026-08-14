import { AutoCloseService } from './auto-close.service';
import * as metaTexto from '../whatsapp/meta-texto';

/**
 * O encerramento automático, que agora fala com o cliente.
 *
 * Duas coisas precisam continuar verdadeiras ao mesmo tempo, e elas puxam
 * pra lados opostos:
 *
 * 1. O cliente precisa saber que a conversa foi encerrada. Sem isso ela
 *    some só do nosso lado, e ele volta dias depois cobrando uma resposta
 *    que aqui dentro já era assunto fechado.
 * 2. Ligar o recurso não pode disparar mensagem pra centenas de pessoas de
 *    uma vez. Era esse o medo que mantinha o serviço calado.
 *
 * A janela de 24h resolve as duas: fora dela a Meta recusa texto livre de
 * qualquer forma, então o acervo antigo é encerrado em silêncio e só quem
 * parou há 20-24 horas recebe a despedida.
 */
const AGORA = new Date('2026-08-14T12:00:00Z');

/** Horas atrás, a partir do relógio congelado do teste. */
const horasAtras = (horas: number) =>
  new Date(AGORA.getTime() - horas * 60 * 60 * 1000);

function servicoCom(
  conversas: {
    id: string;
    lastMessageAt: Date | null;
    channel?: string;
    phone?: string;
  }[],
  config: Partial<{
    autoCloseHours: number;
    autoCloseNotify: boolean;
    autoCloseMessage: string;
    semWhatsapp: boolean;
  }> = {},
) {
  const encerradas: string[] = [];
  const mensagens: Record<string, unknown>[] = [];

  const client = {
    inboxSettings: {
      findMany: jest.fn().mockResolvedValue([
        {
          tenantId: 'tenant-teste',
          autoCloseHours: config.autoCloseHours ?? 20,
          autoCloseNotify: config.autoCloseNotify ?? true,
          autoCloseMessage:
            config.autoCloseMessage ?? 'Vamos encerrar por aqui. Volte sempre!',
        },
      ]),
    },
    conversation: {
      findMany: jest.fn().mockResolvedValue(
        conversas.map((conversa) => ({
          id: conversa.id,
          lastMessageAt: conversa.lastMessageAt,
          channel: conversa.channel ?? 'WHATSAPP',
          customer: { phone: conversa.phone ?? '5511999990000' },
        })),
      ),
      updateMany: jest
        .fn()
        .mockImplementation((args: { where: { id: { in: string[] } } }) => {
          encerradas.push(...args.where.id.in);
          return { count: args.where.id.in.length };
        }),
    },
    message: {
      createMany: jest.fn().mockResolvedValue({ count: conversas.length }),
      create: jest
        .fn()
        .mockImplementation((args: { data: Record<string, unknown> }) => {
          mensagens.push(args.data);
          return args.data;
        }),
    },
    whatsAppSettings: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          config.semWhatsapp
            ? null
            : { phoneNumberId: '123', accessTokenEncrypted: 'cifrado' },
        ),
    },
  };

  const service = new AutoCloseService(
    { client } as never,
    { decrypt: jest.fn().mockReturnValue('token') } as never,
  );

  return { service, encerradas, mensagens, client };
}

describe('encerramento por inatividade', () => {
  let postar: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(AGORA);
    postar = jest
      .spyOn(metaTexto, 'postarTexto')
      .mockResolvedValue({ wamid: 'wamid-1' });
  });

  afterEach(() => {
    jest.useRealTimers();
    postar.mockRestore();
  });

  it('encerra o que passou do limite', async () => {
    const { service, encerradas } = servicoCom([
      { id: 'c1', lastMessageAt: horasAtras(21) },
    ]);

    await service.varrer();

    expect(encerradas).toEqual(['c1']);
  });

  it('avisa quem ainda está dentro da janela de 24h', async () => {
    const { service, mensagens } = servicoCom([
      { id: 'c1', lastMessageAt: horasAtras(21) },
    ]);

    await service.varrer();

    expect(postar).toHaveBeenCalledTimes(1);
    // Gravada como mensagem da empresa: o histórico precisa mostrar o que o
    // cliente recebeu, igual ao aviso do "Resolver" manual.
    expect(mensagens[0]).toMatchObject({
      senderType: 'AGENT',
      status: 'SENT',
      externalId: 'wamid-1',
    });
  });

  it('conversa fora da janela é encerrada EM SILÊNCIO', async () => {
    // É a trava contra o disparo em massa: na primeira varredura depois de
    // ligar o recurso, o acervo antigo inteiro cai aqui. Também é o que a
    // Meta faria de qualquer jeito — fora da janela ela recusa texto livre.
    const { service, encerradas } = servicoCom([
      { id: 'antiga', lastMessageAt: horasAtras(72) },
    ]);

    await service.varrer();

    expect(encerradas).toEqual(['antiga']);
    expect(postar).not.toHaveBeenCalled();
  });

  it('num acervo misto, só as recentes recebem aviso', async () => {
    const { service, encerradas } = servicoCom([
      { id: 'antiga-1', lastMessageAt: horasAtras(100) },
      { id: 'antiga-2', lastMessageAt: horasAtras(48) },
      { id: 'recente', lastMessageAt: horasAtras(22) },
    ]);

    await service.varrer();

    expect(encerradas).toHaveLength(3);
    expect(postar).toHaveBeenCalledTimes(1);
  });

  it('com o aviso desligado, ninguém recebe nada', async () => {
    const { service, encerradas } = servicoCom(
      [{ id: 'c1', lastMessageAt: horasAtras(21) }],
      { autoCloseNotify: false },
    );

    await service.varrer();

    expect(encerradas).toEqual(['c1']);
    expect(postar).not.toHaveBeenCalled();
  });

  it('conversa que não é de WhatsApp não recebe aviso', async () => {
    const { service } = servicoCom([
      { id: 'c1', lastMessageAt: horasAtras(21), channel: 'INTERNAL' },
    ]);

    await service.varrer();

    expect(postar).not.toHaveBeenCalled();
  });

  it('sem WhatsApp conectado, encerra sem tentar enviar', async () => {
    const { service, encerradas } = servicoCom(
      [{ id: 'c1', lastMessageAt: horasAtras(21) }],
      { semWhatsapp: true },
    );

    await service.varrer();

    expect(encerradas).toEqual(['c1']);
    expect(postar).not.toHaveBeenCalled();
  });

  it('uma recusa da Meta não derruba as outras', async () => {
    // Número inválido derruba uma conversa; token expirado derrubaria
    // todas. Parar na primeira falha misturaria os dois casos.
    postar
      .mockResolvedValueOnce({ wamid: null, erro: '400: número inválido' })
      .mockResolvedValueOnce({ wamid: 'wamid-2' });

    const { service, mensagens } = servicoCom([
      { id: 'c1', lastMessageAt: horasAtras(21) },
      { id: 'c2', lastMessageAt: horasAtras(22) },
    ]);

    await service.varrer();

    expect(postar).toHaveBeenCalledTimes(2);
    // Só a que saiu de fato vira mensagem no histórico.
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0]).toMatchObject({ conversationId: 'c2' });
  });

  it('mensagem em branco não vira aviso vazio', async () => {
    const { service } = servicoCom(
      [{ id: 'c1', lastMessageAt: horasAtras(21) }],
      { autoCloseMessage: '   ' },
    );

    await service.varrer();

    expect(postar).not.toHaveBeenCalled();
  });

  it('nada parado, nada acontece', async () => {
    const { service, client } = servicoCom([]);

    await service.varrer();

    expect(client.conversation.updateMany).not.toHaveBeenCalled();
    expect(postar).not.toHaveBeenCalled();
  });
});
