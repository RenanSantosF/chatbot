import { AutoCloseService } from './auto-close.service';
import * as evolution from '../whatsapp/canal/evolution/evolution.client';

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
 * O limite de 24h resolve as duas: o acervo antigo é encerrado em silêncio
 * e só quem parou há pouco recebe a despedida.
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
    sessaoCaida: boolean;
    clienteVoltou: string[];
    soPeloCelular: string[];
  }> = {},
) {
  const encerradas: string[] = [];
  const realtime = { emitToTenant: jest.fn() };
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
        .mockImplementation((args: { where: { id: string } }) => {
          if (config.clienteVoltou?.includes(args.where.id)) {
            return { count: 0 };
          }
          encerradas.push(args.where.id);
          return { count: 1 };
        }),
    },
    message: {
      // Por padrão toda conversa foi atendida pelo Inteliwa (IA ou painel);
      // `soPeloCelular` lista as que foram conduzidas só pelo celular.
      groupBy: jest
        .fn()
        .mockResolvedValue(
          conversas
            .filter((c) => !config.soPeloCelular?.includes(c.id))
            .map((c) => ({ conversationId: c.id })),
        ),
      createMany: jest.fn().mockResolvedValue({ count: conversas.length }),
      create: jest
        .fn()
        .mockImplementation((args: { data: Record<string, unknown> }) => {
          mensagens.push(args.data);
          return args.data;
        }),
    },
    evolutionSettings: {
      findFirst: jest.fn().mockResolvedValue(
        config.semWhatsapp
          ? null
          : {
              baseUrl: 'https://evo.teste',
              apiKeyEncrypted: 'cifrado',
              instance: 'inst',
              estado: config.sessaoCaida ? 'DESCONECTADO' : 'CONECTADO',
            },
      ),
    },
  };

  const service = new AutoCloseService(
    { client } as never,
    { decrypt: jest.fn().mockReturnValue('token') } as never,
    realtime as never,
  );

  return { service, encerradas, mensagens, client, realtime };
}

describe('encerramento por inatividade', () => {
  let postar: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(AGORA);
    postar = jest.spyOn(evolution, 'enviarTexto').mockResolvedValue({
      ok: true,
      dados: { key: { remoteJid: '5511999990000@s.whatsapp.net', id: 'ID1' } },
    });
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

  it('o painel fica sabendo na hora, sem recarregar a página', async () => {
    const { service, realtime } = servicoCom([
      { id: 'c1', lastMessageAt: horasAtras(21) },
    ]);

    await service.varrer();

    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-teste',
      'conversations.encerradas',
      { conversationIds: ['c1'] },
    );
  });

  it('grupo fica de fora — não é atendimento pra encerrar', async () => {
    const { service, client } = servicoCom([
      { id: 'c1', lastMessageAt: horasAtras(21) },
    ]);

    await service.varrer();

    const [[{ where }]] = client.conversation.findMany.mock.calls as [
      [{ where: Record<string, unknown> }],
    ];
    expect(where.customer).toEqual({ isGroup: false });
  });

  /**
   * O relato: "o correto é só se o CLIENTE demorar pra responder". Antes
   * qualquer conversa parada encerrava — inclusive a do cliente que
   * escreveu e ficou sem resposta da equipe.
   */
  it('só encerra quando a empresa respondeu por último e o cliente sumiu', async () => {
    const { service, client } = servicoCom([
      { id: 'c1', lastMessageAt: horasAtras(21) },
    ]);

    await service.varrer();

    const [[{ where }]] = client.conversation.findMany.mock.calls as [
      [{ where: Record<string, unknown> }],
    ];
    // Esperando o cliente, e ninguém do lado de lá esperando a equipe.
    expect(where.status).toBe('WAITING_CUSTOMER');
    expect(where.waitingSince).toBeNull();
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
      externalId: expect.stringContaining('ID1') as string,
    });
  });

  /**
   * O aviso saía pelo caminho oficial da Meta, que nenhuma empresa usa: a
   * função voltava em silêncio e a despedida nunca chegava a ninguém.
   */
  it('o aviso sai pela Evolution, com o número só em dígitos', async () => {
    const { service } = servicoCom([
      { id: 'c1', lastMessageAt: horasAtras(3), phone: '+55 (11) 99999-0000' },
    ]);

    await service.varrer();

    expect(postar).toHaveBeenCalledWith(
      { baseUrl: 'https://evo.teste', apiKey: 'token', instance: 'inst' },
      {
        numero: '5511999990000',
        texto: 'Vamos encerrar por aqui. Volte sempre!',
      },
    );
  });

  it('com a sessão caída, encerra sem tentar avisar', async () => {
    const { service, encerradas } = servicoCom(
      [{ id: 'c1', lastMessageAt: horasAtras(21) }],
      { sessaoCaida: true },
    );

    await service.varrer();

    expect(encerradas).toEqual(['c1']);
    expect(postar).not.toHaveBeenCalled();
  });

  it('cliente que respondeu durante a varredura não é encerrado nem avisado', async () => {
    const { service, encerradas, client } = servicoCom(
      [
        { id: 'voltou', lastMessageAt: horasAtras(21) },
        { id: 'sumiu', lastMessageAt: horasAtras(21) },
      ],
      { clienteVoltou: ['voltou'] },
    );

    await service.varrer();

    expect(encerradas).toEqual(['sumiu']);
    expect(postar).toHaveBeenCalledTimes(1);
    const [[{ data }]] = client.message.createMany.mock.calls as [
      [{ data: { conversationId: string }[] }],
    ];
    expect(data.map((nota) => nota.conversationId)).toEqual(['sumiu']);
  });

  /**
   * O relato: um contato pessoal, com quem o dono conversou só pelo
   * celular, recebeu "vamos encerrar por aqui" de uma empresa.
   */
  it('conversa conduzida só pelo celular encerra sem despedida', async () => {
    const { service, encerradas } = servicoCom(
      [
        { id: 'pessoal', lastMessageAt: horasAtras(3) },
        { id: 'atendida', lastMessageAt: horasAtras(3) },
      ],
      { soPeloCelular: ['pessoal'] },
    );

    await service.varrer();

    expect(encerradas).toEqual(['pessoal', 'atendida']);
    expect(postar).toHaveBeenCalledTimes(1);
  });

  it('conversa fora da janela é encerrada EM SILÊNCIO', async () => {
    // É a trava contra o disparo em massa: na primeira varredura depois de
    // ligar o recurso, o acervo antigo inteiro cai aqui.
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

  it('uma recusa não derruba as outras', async () => {
    // Número inválido derruba uma conversa; sessão caída derrubaria
    // todas. Parar na primeira falha misturaria os dois casos.
    postar
      .mockResolvedValueOnce({ ok: false, erro: 'número inválido' })
      .mockResolvedValueOnce({ ok: true, dados: { key: { id: 'ID2' } } });

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
