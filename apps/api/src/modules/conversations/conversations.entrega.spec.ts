import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

/**
 * O tique de entrega e o apagar.
 *
 * Os dois são sobre o que o painel AFIRMA. Um tique azul indevido diz que
 * alguém leu quando ninguém leu; uma mensagem apagada que continua saindo
 * pela API é um apagar pela metade — que é pior que não ter o recurso,
 * porque a tela promete uma coisa e o sistema faz outra.
 */
function montar(
  estado: {
    mensagem?: Record<string, unknown> | null;
    conversa?: Record<string, unknown> | null;
  } = {},
) {
  const atualizacoes: Record<string, unknown>[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            estado.conversa !== undefined
              ? estado.conversa
              : { id: 'conversa-1' },
          ),
        update: jest.fn().mockResolvedValue({ id: 'conversa-1', messages: [] }),
      },
      message: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            estado.mensagem !== undefined ? estado.mensagem : null,
          ),
        update: jest.fn().mockImplementation((args: { data: unknown }) => {
          atualizacoes.push(args.data as Record<string, unknown>);
          return {
            ...(estado.mensagem ?? {}),
            ...(args.data as object),
            conversationId: 'conversa-1',
          };
        }),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
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

  return { service, prisma, realtime, atualizacoes };
}

describe('status de entrega vindo do webhook', () => {
  const mensagemCom = (status: string) => ({
    id: 'msg-1',
    conversationId: 'conversa-1',
    status,
  });

  it('avança do enviado pro entregue', async () => {
    const { service, atualizacoes } = montar({ mensagem: mensagemCom('SENT') });

    await service.applyDeliveryStatus('wamid.1', 'DELIVERED');

    expect(atualizacoes).toEqual([{ status: 'DELIVERED' }]);
  });

  it('um "entregue" atrasado não apaga o tique azul', async () => {
    // A Meta não garante a ordem de entrega dos webhooks. Sem esta regra,
    // o tique azul do cliente piscava e voltava pra cinza.
    const { service, atualizacoes } = montar({ mensagem: mensagemCom('READ') });

    await service.applyDeliveryStatus('wamid.1', 'DELIVERED');

    expect(atualizacoes).toEqual([]);
  });

  it('o mesmo status repetido não gera evento novo', async () => {
    const { service, realtime } = montar({
      mensagem: mensagemCom('DELIVERED'),
    });

    await service.applyDeliveryStatus('wamid.1', 'DELIVERED');

    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });

  it('falha é terminal: nada volta a marcar como entregue depois dela', async () => {
    // Se a Meta disse que falhou, o triângulo vermelho fica. Um "delivered"
    // atrasado dizendo o contrário faria o atendente achar que chegou.
    const { service, atualizacoes } = montar({
      mensagem: mensagemCom('FAILED'),
    });

    await service.applyDeliveryStatus('wamid.1', 'READ');

    expect(atualizacoes).toEqual([]);
  });

  it('uma falha ainda alcança a mensagem já lida', async () => {
    const { service, atualizacoes } = montar({ mensagem: mensagemCom('READ') });

    await service.applyDeliveryStatus('wamid.1', 'FAILED');

    expect(atualizacoes).toEqual([{ status: 'FAILED' }]);
  });

  it('status de mensagem desconhecida é ignorado sem estourar', async () => {
    // Acontece o tempo todo: mensagem apagada por retenção, ou enviada
    // antes deste sistema existir.
    const { service, realtime } = montar({ mensagem: null });

    await expect(
      service.applyDeliveryStatus('wamid.desconhecido', 'READ'),
    ).resolves.toBeUndefined();
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });

  it('avisa o painel quando o status realmente mudou', async () => {
    const { service, realtime } = montar({ mensagem: mensagemCom('SENT') });

    await service.applyDeliveryStatus('wamid.1', 'READ');

    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-teste',
      'message.status',
      expect.objectContaining({ messageId: 'msg-1', status: 'READ' }),
    );
  });
});

describe('apagar mensagem do painel', () => {
  const dono = { userId: 'user-ana', role: 'AGENT' as const };
  const daAna = {
    id: 'msg-1',
    senderType: 'AGENT',
    senderId: 'user-ana',
    deletedAt: null,
    content: 'texto original',
  };

  it('quem escreveu apaga o que escreveu', async () => {
    const { service, atualizacoes } = montar({ mensagem: daAna });

    await service.apagarMensagem('conversa-1', 'msg-1', dono);

    expect(atualizacoes[0]).toMatchObject({ deletedById: 'user-ana' });
    expect(atualizacoes[0].deletedAt).toBeInstanceOf(Date);
  });

  it('é apagamento lógico: o texto continua no banco', async () => {
    // Histórico de atendimento é prova. Apagar de verdade transformaria um
    // clique errado em perda de prova numa reclamação ou num processo.
    const { service, atualizacoes } = montar({ mensagem: daAna });

    await service.apagarMensagem('conversa-1', 'msg-1', dono);

    expect(atualizacoes[0]).not.toHaveProperty('content');
  });

  it('atendente não apaga a mensagem de um colega', async () => {
    const { service } = montar({
      mensagem: { ...daAna, senderId: 'user-bruno' },
    });

    await expect(
      service.apagarMensagem('conversa-1', 'msg-1', dono),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('dono e admin apagam qualquer coisa — respondem pelo que a empresa disse', async () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const { service, atualizacoes } = montar({
        mensagem: { ...daAna, senderType: 'AI', senderId: null },
      });

      await service.apagarMensagem('conversa-1', 'msg-1', {
        userId: 'user-chefe',
        role,
      });

      expect(atualizacoes).toHaveLength(1);
    }
  });

  it('mensagem do cliente não é apagável: é registro do que ele disse', async () => {
    const { service } = montar({
      mensagem: { ...daAna, senderType: 'CUSTOMER', senderId: null },
    });

    await expect(
      service.apagarMensagem('conversa-1', 'msg-1', {
        userId: 'user-chefe',
        role: 'OWNER',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('apagar duas vezes não é erro — dois cliques não são uma falha', async () => {
    const jaApagada = { ...daAna, deletedAt: new Date() };
    const { service, atualizacoes } = montar({ mensagem: jaApagada });

    await expect(
      service.apagarMensagem('conversa-1', 'msg-1', dono),
    ).resolves.toBe(jaApagada);
    expect(atualizacoes).toEqual([]);
  });

  it('o evento em tempo real já sai sem o conteúdo', async () => {
    // É aqui que o texto para de trafegar: quem estiver com a conversa
    // aberta não pode receber o conteúdo do que acabou de ser apagado.
    const { service, realtime } = montar({ mensagem: daAna });

    await service.apagarMensagem('conversa-1', 'msg-1', dono);

    const [, , payload] = realtime.emitToTenant.mock.calls[0] as [
      string,
      string,
      { message: { content: string; metadata: unknown } },
    ];
    expect(payload.message.content).toBe('');
    // Sem mediaId não há como o proxy baixar o anexo — apagar vale pro
    // arquivo também.
    expect(payload.message.metadata).toBeNull();
  });
});

describe('encaminhar mensagem', () => {
  it('recusa encaminhar o que foi apagado', async () => {
    // Apagar e continuar podendo encaminhar não é apagar: o conteúdo já
    // não aparece no painel, mas sairia inteiro pro cliente de outra
    // conversa.
    const { service } = montar({
      mensagem: {
        id: 'msg-1',
        senderType: 'AGENT',
        deletedAt: new Date(),
        messageType: 'TEXT',
        content: 'texto original',
      },
    });

    await expect(
      service.forwardMessage('msg-1', 'conversa-2', 'user-ana'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('a chave que chega diferente da que foi gravada', () => {
  /**
   * O defeito relatado na Evolution: envio funcionando, cliente recebendo,
   * e o balão parado no relógio. O id externo dela é uma chave composta
   * (conversa + de quem + id), e o WhatsApp escreve a parte "conversa" de
   * um jeito na resposta do envio e de outro no evento de entrega —
   * inclusive como `@lid`, um identificador opaco de onde não se recupera
   * o telefone.
   *
   * `normalizarJid` acerta a maioria na gravação. Estes testes guardam a
   * rede que pega o resto: procurar pelo ID DA MENSAGEM, que é único e
   * nunca muda de forma.
   */
  function montarComBusca(porExterno: Record<string, unknown | null>) {
    const consultas: Record<string, unknown>[] = [];

    const prisma = {
      tenantId: 'tenant-teste',
      db: {
        message: {
          findFirst: jest
            .fn()
            .mockImplementation((args: { where: Record<string, unknown> }) => {
              consultas.push(args.where);
              const alvo = args.where.externalId;
              if (typeof alvo === 'string') return porExterno[alvo] ?? null;
              const sufixo = (alvo as { endsWith?: string })?.endsWith;
              return sufixo ? (porExterno[sufixo] ?? null) : null;
            }),
          update: jest
            .fn()
            .mockImplementation((args: { data: unknown }) => ({
              id: 'msg-1',
              conversationId: 'conversa-1',
              ...(args.data as object),
            })),
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
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, consultas };
  }

  const GRAVADO = '5527999998888@s.whatsapp.net|1|3EB0ABC';
  const MENSAGEM = { id: 'msg-1', status: 'SENT', conversationId: 'conversa-1' };

  it('acha pela busca exata quando as duas formas batem', async () => {
    const { service, consultas } = montarComBusca({ [GRAVADO]: MENSAGEM });

    await service.applyDeliveryStatus(GRAVADO, 'DELIVERED');

    // Uma consulta só: o caminho oficial nunca paga pela rede de segurança.
    expect(consultas).toHaveLength(1);
  });

  it('acha pelo id da mensagem quando a conversa veio como @lid', async () => {
    // O evento chega com uma chave que não existe no banco; a mensagem só
    // é encontrada pelo id.
    const { service, consultas } = montarComBusca({ '|3EB0ABC': MENSAGEM });

    await service.applyDeliveryStatus('199887766@lid|1|3EB0ABC', 'DELIVERED');

    expect(consultas).toHaveLength(2);
    expect(consultas[1].externalId).toEqual({ endsWith: '|3EB0ABC' });
  });

  it('não procura pedaço nenhum num id que não é chave composta', async () => {
    // O `wamid` da Meta é uma string só. Uma segunda consulta aqui seria
    // varredura de tabela em todo webhook do caminho oficial.
    const { service, consultas } = montarComBusca({});

    await service.applyDeliveryStatus('wamid.HBgNNTUyNw==', 'DELIVERED');

    expect(consultas).toHaveLength(1);
  });
});
