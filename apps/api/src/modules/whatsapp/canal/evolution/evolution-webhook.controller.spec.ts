import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedRequest } from '../../../auth/auth.types';
import type { ConversationsService } from '../../../conversations/conversations.service';
import { EvolutionWebhookController } from './evolution-webhook.controller';

const SEGREDO = 'a'.repeat(48);

function montar() {
  const conversations = {
    receiveInbound: jest.fn().mockResolvedValue({}),
    recordOutboundEcho: jest.fn().mockResolvedValue({}),
    applyDeliveryStatus: jest.fn().mockResolvedValue({}),
    applyReaction: jest.fn().mockResolvedValue({}),
    aplicarApagadaExterna: jest.fn().mockResolvedValue({}),
    importarHistorico: jest.fn().mockResolvedValue(2),
  };

  const config = {
    id: 'config-1',
    tenantId: 'tenant-1',
    instance: 'inteliwa-1',
    webhookSecret: SEGREDO,
    // Nulo = nunca pareou. Os testes que precisam de "já pareado"
    // sobrescrevem isto pelo findFirst.
    lastSeenAt: null as Date | null,
    estado: 'CONECTADO',
  };

  const prisma = {
    client: {
      // O grupo consulta o cliente pra saber se já tem nome gravado.
      customer: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      evolutionSettings: {
        findFirst: jest.fn().mockResolvedValue(config),
        update: jest
          .fn()
          .mockResolvedValue({ ...config, historicoEstado: 'IMPORTANDO', historicoMensagens: 2 }),
      },
    },
  };

  const realtime = { emitToTenant: jest.fn() };
  const media = { arquivar: jest.fn().mockResolvedValue(undefined) };
  const customers = {
    upsertFromAddressBook: jest.fn().mockResolvedValue({}),
    importarAgenda: jest.fn().mockResolvedValue({ recebidos: 1, salvos: 1 }),
  };

  const evolution = { nomeDoGrupo: jest.fn().mockResolvedValue(null) };

  const controller = new EvolutionWebhookController(
    prisma as unknown as PrismaService,
    conversations as unknown as ConversationsService,
    realtime as never,
    media as never,
    customers as never,
    evolution as never,
  );

  const req = {} as AuthenticatedRequest;
  return { controller, conversations, prisma, req, realtime, media, customers, evolution };
}

function mensagem(extra: Record<string, unknown> = {}) {
  return {
    event: 'messages.upsert',
    instance: 'inteliwa-1',
    data: {
      key: {
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: false,
        id: '3EB0ABC',
      },
      pushName: 'Ana',
      messageTimestamp: 1755300000,
      message: { conversation: 'bom dia' },
      ...extra,
    },
  };
}

describe('porta de entrada', () => {
  it('recusa segredo em formato inválido sem nem consultar o banco', async () => {
    // O endereço do webhook é público. Sem a conferência de formato, cada
    // batida de robô vira uma consulta na tabela.
    const { controller, prisma, req } = montar();

    await expect(
      controller.receber('curto', req, mensagem()),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.client.evolutionSettings.findFirst).not.toHaveBeenCalled();
  });

  it('recusa segredo desconhecido', async () => {
    const { controller, prisma, req } = montar();
    prisma.client.evolutionSettings.findFirst.mockResolvedValue(null);

    await expect(
      controller.receber('b'.repeat(48), req, mensagem()),
    ).rejects.toThrow(ForbiddenException);
  });

  it('ignora evento de outra sessão que chegou pela URL errada', async () => {
    // Servidor mal configurado apontando duas sessões pra mesma URL
    // criaria mensagem de uma empresa dentro do painel de outra.
    const { controller, conversations, req } = montar();

    await controller.receber(SEGREDO, req, {
      ...mensagem(),
      instance: 'outra-empresa',
    });

    expect(conversations.receiveInbound).not.toHaveBeenCalled();
  });

  it('resolve a empresa pelo segredo da URL', async () => {
    const { controller, req } = montar();

    await controller.receber(SEGREDO, req, mensagem());

    expect(req.user).toMatchObject({ tenantId: 'tenant-1' });
  });

  it('entrega na empresa DONA DA SESSÃO quando duas dividem o segredo', async () => {
    /*
     * O defeito de isolamento (ver TENANT_SCOPED_MODELS) fez empresas
     * diferentes compartilharem a mesma linha de configuração, e com ela
     * o mesmo segredo. Buscando só pelo segredo, o banco devolvia uma
     * delas — a que quisesse — e todo evento das outras era descartado
     * como "sessão diferente". Do lado de fora: conecta, diz conectado, e
     * nenhuma conversa aparece.
     */
    const { controller, prisma, conversations, req } = montar();
    prisma.client.evolutionSettings.findFirst.mockImplementation(
      ({ where }: { where: { instance?: string; webhookSecret?: string } }) =>
        Promise.resolve(
          where.instance === 'inteliwa-2'
            ? {
                id: 'config-2',
                tenantId: 'tenant-2',
                instance: 'inteliwa-2',
                webhookSecret: SEGREDO,
                lastSeenAt: null,
                estado: 'CONECTADO',
              }
            : where.instance
              ? null
              : {
                  id: 'config-1',
                  tenantId: 'tenant-1',
                  instance: 'inteliwa-1',
                  webhookSecret: SEGREDO,
                  lastSeenAt: null,
                  estado: 'CONECTADO',
                },
        ),
    );

    await controller.receber(SEGREDO, req, {
      ...mensagem(),
      instance: 'inteliwa-2',
    });

    expect(req.user).toMatchObject({ tenantId: 'tenant-2' });
    expect(conversations.receiveInbound).toHaveBeenCalled();
  });

  it('recusa quando o segredo não é o da sessão que o evento diz ser', async () => {
    // Achar a linha pelo nome da sessão não pode afrouxar a autenticação:
    // quem tem o segredo de uma empresa não entrega evento em nome de
    // outra.
    const { controller, prisma, req } = montar();
    prisma.client.evolutionSettings.findFirst.mockResolvedValue({
      id: 'config-2',
      tenantId: 'tenant-2',
      instance: 'inteliwa-2',
      webhookSecret: 'c'.repeat(48),
      lastSeenAt: null,
      estado: 'CONECTADO',
    });

    await expect(
      controller.receber(SEGREDO, req, { ...mensagem(), instance: 'inteliwa-2' }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('mensagem que chega', () => {
  it('grava a mensagem do cliente com hora, nome e chave', async () => {
    const { controller, conversations, req } = montar();

    await controller.receber(SEGREDO, req, mensagem());

    expect(conversations.receiveInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        customerPhone: '5511999999999',
        customerName: 'Ana',
        content: 'bom dia',
        messageType: 'TEXT',
        externalId: '5511999999999@s.whatsapp.net|0|3EB0ABC',
        createdAt: new Date(1755300000 * 1000),
      }),
    );
  });

  it('trata o que a empresa escreveu pelo celular como resposta, não como recebida', async () => {
    // Conexão por aparelho vinculado quer dizer que o celular continua na
    // mão de alguém. Sem isto, o painel mostraria a pergunta e nunca a
    // resposta — e a IA responderia por cima de quem já respondeu.
    const { controller, conversations, req } = montar();

    await controller.receber(
      SEGREDO,
      req,
      mensagem({
        key: {
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: true,
          id: '3EB0RESP',
        },
        message: { conversation: 'já estou vendo' },
      }),
    );

    expect(conversations.recordOutboundEcho).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'já estou vendo' }),
    );
    expect(conversations.receiveInbound).not.toHaveBeenCalled();
  });

  it('status e transmissão continuam de fora', async () => {
    // Ninguém responde a um status pelo painel. Tratá-lo como atendimento
    // encheria a caixa de linhas que nunca vão ser lidas.
    const { controller, conversations, req } = montar();

    await controller.receber(
      SEGREDO,
      req,
      mensagem({ key: { remoteJid: 'status@broadcast', fromMe: false, id: 'X' } }),
    );

    expect(conversations.receiveInbound).not.toHaveBeenCalled();
  });

  it('grupo entra como conversa, marcado como grupo e com quem falou', async () => {
    /*
     * Grupo era descartado junto com status. Agora ele entra, e o que
     * separa os dois casos é `identidadeDoDestino`.
     *
     * Duas coisas precisam ir juntas: a bandeira de grupo, que é o que
     * mantém a IA fora e o relógio de espera parado, e o participante, sem
     * o qual a conversa vira quinze mensagens seguidas sem dizer quem
     * falou o quê.
     */
    const { controller, conversations, req } = montar();

    await controller.receber(
      SEGREDO,
      req,
      mensagem({ key: { remoteJid: '120363000@g.us', fromMe: false, id: 'X' } }),
    );

    expect(conversations.receiveInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        // O JID inteiro, e não dígitos: grupo não tem telefone, e a
        // limpeza montaria um destino individual que não existe.
        customerPhone: '120363000@g.us',
        grupo: true,
        participante: 'Ana',
      }),
    );
  });

  it('o nome do grupo vem da consulta, não do pushName da mensagem', async () => {
    // O `pushName` de uma mensagem de grupo é de QUEM ESCREVEU. Usá-lo
    // como nome da conversa faria o grupo se chamar "Ana" — e trocar de
    // nome a cada pessoa que falasse.
    const { controller, conversations, req, evolution } = montar();
    evolution.nomeDoGrupo.mockResolvedValue('Fornecedores');

    await controller.receber(
      SEGREDO,
      req,
      mensagem({ key: { remoteJid: '120363000@g.us', fromMe: false, id: 'X' } }),
    );

    expect(conversations.receiveInbound).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: 'Fornecedores' }),
    );
  });

  it('aceita o lote com várias mensagens', async () => {
    const { controller, conversations, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'messages.upsert',
      instance: 'inteliwa-1',
      data: [mensagem().data, { ...mensagem().data, key: { remoteJid: '5511888888888@s.whatsapp.net', fromMe: false, id: '3EB0DEF' } }],
    });

    expect(conversations.receiveInbound).toHaveBeenCalledTimes(2);
  });
});

describe('reação', () => {
  it('modifica a mensagem reagida em vez de virar linha nova', async () => {
    // Sem isto a reação cairia na tradução, seria descartada como "tipo
    // não suportado", e o cliente reagiria no vazio.
    const { controller, conversations, req } = montar();

    await controller.receber(
      SEGREDO,
      req,
      mensagem({
        message: {
          reactionMessage: {
            key: {
              remoteJid: '5511999999999@s.whatsapp.net',
              fromMe: true,
              id: '3EB0ALVO',
            },
            text: '❤️',
          },
        },
      }),
    );

    expect(conversations.applyReaction).toHaveBeenCalledWith(
      '5511999999999@s.whatsapp.net|1|3EB0ALVO',
      '❤️',
      '5511999999999',
    );
    expect(conversations.receiveInbound).not.toHaveBeenCalled();
  });

  it('credita à empresa a reação feita pelo celular dela', async () => {
    // Creditar ao cliente colocaria o emoji do lado errado do balão.
    const { controller, conversations, req } = montar();

    await controller.receber(
      SEGREDO,
      req,
      mensagem({
        key: {
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: true,
          id: '3EB0REACAO',
        },
        message: {
          reactionMessage: {
            key: {
              remoteJid: '5511999999999@s.whatsapp.net',
              fromMe: false,
              id: '3EB0ALVO',
            },
            text: '👍',
          },
        },
      }),
    );

    expect(conversations.applyReaction).toHaveBeenCalledWith(
      '5511999999999@s.whatsapp.net|0|3EB0ALVO',
      '👍',
      'agent',
    );
    expect(conversations.recordOutboundEcho).not.toHaveBeenCalled();
  });

  it('aceita o emoji vazio, que é desfazer a reação', async () => {
    const { controller, conversations, req } = montar();

    await controller.receber(
      SEGREDO,
      req,
      mensagem({
        message: {
          reactionMessage: {
            key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: true, id: 'A' },
            text: '',
          },
        },
      }),
    );

    expect(conversations.applyReaction).toHaveBeenCalledWith(
      expect.any(String),
      '',
      '5511999999999',
    );
  });
});

describe('apagar para todos', () => {
  it('some do painel quando some do aparelho', async () => {
    // A empresa retira a mensagem porque estava errada, o cliente não a vê
    // mais, e o painel seguia mostrando como dito algo que ninguém disse.
    const { controller, conversations, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'messages.delete',
      instance: 'inteliwa-1',
      data: {
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: true,
        id: '3EB0APAGADA',
        status: 'DELETED',
      },
    });

    expect(conversations.aplicarApagadaExterna).toHaveBeenCalledWith(
      '5511999999999@s.whatsapp.net|1|3EB0APAGADA',
    );
  });
});

describe('status de entrega', () => {
  it('vira o tique na mensagem certa', async () => {
    // O formato achatado é o que a Evolution manda de verdade neste
    // evento: `keyId`, `remoteJid` e `fromMe` na raiz, sem `key`.
    const { controller, conversations, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'messages.update',
      instance: 'inteliwa-1',
      data: {
        keyId: 'EVO1',
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: true,
        status: 'DELIVERY_ACK',
      },
    });

    expect(conversations.applyDeliveryStatus).toHaveBeenCalledWith(
      '5511999999999@s.whatsapp.net|1|EVO1',
      'DELIVERED',
    );
  });

  it('ignora status que não conhece em vez de inventar', async () => {
    const { controller, conversations, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'messages.update',
      instance: 'inteliwa-1',
      data: {
        keyId: 'EVO1',
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: true,
        status: 'ALGO_NOVO',
      },
    });

    expect(conversations.applyDeliveryStatus).not.toHaveBeenCalled();
  });
});

describe('histórico do aparelho', () => {
  it('aceita o formato do webhook: lista em data, andamento na raiz', async () => {
    // Foi assim que a importação ficava eterna. O evento chega com a
    // lista direto em `data` e o "é o último?" na raiz; o código só sabia
    // ler `data.messages`, então nenhuma conversa entrava e o aviso de
    // fim nunca vinha — sem erro em lugar nenhum.
    const { controller, conversations, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'messages.set',
      instance: 'inteliwa-1',
      isLatest: true,
      data: [
        {
          key: {
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: false,
            id: '3EB0ANTIGA',
          },
          pushName: 'Ana',
          messageTimestamp: 1755300000,
          message: { conversation: 'mensagem de ontem' },
        },
      ],
    });

    expect(conversations.importarHistorico).toHaveBeenCalledWith(
      expect.objectContaining({ customerPhone: '5511999999999' }),
    );
  });
});

describe('estado da conexão', () => {
  it('marca conectado e apaga o QR code usado', async () => {
    const { controller, prisma, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'connection.update',
      instance: 'inteliwa-1',
      data: { state: 'open' },
    });

    expect(prisma.client.evolutionSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'CONECTADO', qrCode: null }),
      }),
    );
  });

  it('não marca desconectado no reinício que o protocolo exige', async () => {
    // Depois de parear, o WhatsApp EXIGE que o socket caia e volte, e
    // avisa isso com um `close` de motivo 515. É a regra no pareamento
    // por código. Gravar "desconectado" aqui punha a faixa vermelha de
    // "as mensagens não vão chegar" numa sessão recém-conectada.
    const { controller, prisma, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'connection.update',
      instance: 'inteliwa-1',
      data: { state: 'close', statusReason: 515 },
    });

    expect(prisma.client.evolutionSettings.update).not.toHaveBeenCalled();
  });

  it('separa "sem internet" de "aparelho desvinculado"', async () => {
    // Só o segundo exige ler o QR code de novo; mandar todo mundo
    // reconectar por qualquer oscilação seria fazer a empresa correr atrás
    // do celular à toa.
    const { controller, prisma, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'connection.update',
      instance: 'inteliwa-1',
      data: { state: 'close', statusReason: 401 },
    });

    expect(prisma.client.evolutionSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'DESCONECTADO',
          lastError: expect.stringContaining('desvinculado'),
        }),
      }),
    );
  });

  it('guarda o QR code novo que o servidor gerou', async () => {
    const { controller, prisma, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'qrcode.updated',
      instance: 'inteliwa-1',
      data: { qrcode: { base64: 'data:image/png;base64,AAA' } },
    });

    expect(prisma.client.evolutionSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          qrCode: 'data:image/png;base64,AAA',
          estado: 'AGUARDANDO_QRCODE',
        }),
      }),
    );
  });
});

describe('anexo recebido ganha por onde ser buscado', () => {
  /**
   * O relato: anexo não aparecia. A tradução marcava a mídia como
   * "pendente" porque ela é função pura e não conhece a chave da mensagem
   * — e a chave é justamente o que a Evolution usa pra devolver o binário,
   * já que ela não hospeda arquivo com id, como a Meta.
   *
   * Quem tem a chave é o controlador, e é aqui que ela vira o handle.
   */
  it('a foto chega com o handle no lugar da marca de pendente', async () => {
    const { controller, conversations, req } = montar();

    await controller.receber(
      SEGREDO,
      req,
      mensagem({
        message: {
          imageMessage: { mimetype: 'image/jpeg', caption: 'olha isso' },
        },
      }),
    );

    const recebida = conversations.receiveInbound.mock.calls[0][0] as {
      metadata: Record<string, unknown>;
    };
    expect(recebida.metadata.mediaId).toBe(
      '5511999999999@s.whatsapp.net|0|3EB0ABC',
    );
    expect(recebida.metadata.evolutionPendente).toBeUndefined();
  });

  it('o áudio de voz mantém a marca de voz junto do handle', async () => {
    // As duas coisas convivem: `voice` decide o desenho do balão, o handle
    // decide se dá pra tocar.
    const { controller, conversations, req } = montar();

    await controller.receber(
      SEGREDO,
      req,
      mensagem({
        message: {
          audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true },
        },
      }),
    );

    const recebida = conversations.receiveInbound.mock.calls[0][0] as {
      metadata: Record<string, unknown>;
    };
    expect(recebida.metadata.voice).toBe(true);
    expect(recebida.metadata.mediaId).toBe(
      '5511999999999@s.whatsapp.net|0|3EB0ABC',
    );
  });

  it('mensagem de texto continua sem handle nenhum', async () => {
    const { controller, conversations, req } = montar();

    await controller.receber(SEGREDO, req, mensagem());

    const recebida = conversations.receiveInbound.mock.calls[0][0] as {
      metadata?: Record<string, unknown>;
    };
    expect(recebida.metadata).toBeUndefined();
  });
});

describe('a tela fica sabendo na hora', () => {
  /**
   * O relato: "mostrar através de websocket na hora quando desconectar do
   * aparelho". Antes a queda só ia pro banco — quem estivesse no painel
   * continuava atendendo, digitando resposta e apertando enviar, enquanto
   * as mensagens sumiam no caminho. A verdade só aparecia na próxima vez
   * que alguém abrisse as configurações.
   */
  it('avisa a queda assim que ela acontece', async () => {
    const { controller, req, realtime } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'connection.update',
      instance: 'inteliwa-1',
      data: { state: 'close', statusReason: 401 },
    });

    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'canal.estado',
      expect.objectContaining({ estado: 'DESCONECTADO' }),
    );
  });

  it('o aviso diz se o aparelho foi desvinculado', async () => {
    // A diferença é acionável: desvinculado exige ler o QR code de novo,
    // queda de rede volta sozinha.
    const { controller, req, realtime } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'connection.update',
      instance: 'inteliwa-1',
      data: { state: 'close', statusReason: 401 },
    });

    const aviso = realtime.emitToTenant.mock.calls[0][2] as {
      lastError: string;
    };
    expect(aviso.lastError).toContain('desvinculado');
  });

  it('avisa a volta, sem erro pendurado', async () => {
    const { controller, req, realtime } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'connection.update',
      instance: 'inteliwa-1',
      data: { state: 'open' },
    });

    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'canal.estado',
      { estado: 'CONECTADO', lastError: null },
    );
  });

  it('empurra o QR code no instante em que ele nasce', async () => {
    // A criação da sessão demora segundos pra responder, mas a Evolution
    // avisa o código bem antes disso. Esperar a resposta era o que fazia a
    // tela levar vinte segundos pra mostrar a imagem.
    const { controller, req, realtime } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'qrcode.updated',
      instance: 'inteliwa-1',
      data: { qrcode: { base64: 'data:image/png;base64,AAA' } },
    });

    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'canal.estado',
      { estado: 'AGUARDANDO_QRCODE', qrCode: 'data:image/png;base64,AAA' },
    );
  });
});

describe('o anexo é guardado enquanto ele existe', () => {
  /**
   * O relato: a foto chegava como cartão de arquivo genérico e, ao
   * clicar, "não deu pra buscar este anexo no WhatsApp".
   *
   * A Evolution não hospeda arquivo — ela pede ao WhatsApp usando a chave
   * da mensagem, e só consegue enquanto a mensagem estiver ao alcance
   * dela. Buscar sob demanda, minutos depois, é tarde. A cópia própria
   * tem que ser feita na chegada.
   */
  it('arquiva a mídia recebida, pelo mesmo handle que o balão usa', async () => {
    const { controller, req, media } = montar();

    await controller.receber(
      SEGREDO,
      req,
      mensagem({
        message: { imageMessage: { mimetype: 'image/jpeg', fileName: 'foto.jpg' } },
      }),
    );

    expect(media.arquivar).toHaveBeenCalledWith(
      '5511999999999@s.whatsapp.net|0|3EB0ABC',
      'foto.jpg',
    );
  });

  it('mensagem de texto não vira arquivamento à toa', async () => {
    const { controller, req, media } = montar();

    await controller.receber(SEGREDO, req, mensagem());

    expect(media.arquivar).not.toHaveBeenCalled();
  });
});

/**
 * O lote de histórico, no formato que a Evolution entrega ao parear.
 *
 * Este evento existir é a diferença entre o painel nascer com as
 * conversas do aparelho e nascer vazio — e, pior, entre a conversa que a
 * empresa teve pelo celular enquanto o painel estava desconectado voltar
 * ou sumir pra sempre.
 */
function loteDeHistorico(
  mensagens: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  return {
    event: 'messaging-history.set',
    instance: 'inteliwa-1',
    data: { messages: mensagens, ...extra },
  };
}

function doHistorico(
  telefone: string,
  texto: string,
  extra: Record<string, unknown> = {},
) {
  return {
    key: {
      remoteJid: `${telefone}@s.whatsapp.net`,
      fromMe: false,
      id: `id-${texto.replace(/\W/g, '')}`,
    },
    pushName: 'Richard',
    messageTimestamp: 1755300000,
    message: { conversation: texto },
    ...extra,
  };
}

describe('as conversas que já estavam no aparelho', () => {
  it('importa o lote agrupado por contato', async () => {
    const { controller, conversations, req } = montar();

    await controller.receber(
      SEGREDO,
      req,
      loteDeHistorico([
        doHistorico('5511999999999', 'oi Richard'),
        doHistorico('5511999999999', 'tudo certo?'),
        doHistorico('5527888888888', 'e aí barbeiro'),
      ]),
    );

    // Uma chamada por CONTATO, não uma por mensagem: o lote real tem
    // milhares de linhas, e uma ida ao banco por linha inviabilizaria.
    expect(conversations.importarHistorico).toHaveBeenCalledTimes(2);

    const richard = conversations.importarHistorico.mock.calls.find(
      ([arg]) => arg.customerPhone === '5511999999999',
    )?.[0];
    expect(richard.mensagens).toHaveLength(2);
    expect(richard.mensagens[0].content).toBe('oi Richard');
  });

  it('traz também o que a EMPRESA mandou pelo celular', async () => {
    // O caso que motivou tudo: a conversa continuou pelo aparelho com o
    // painel desconectado. Se só o que o cliente escreveu voltasse, o
    // histórico contaria metade da conversa.
    const { controller, conversations, req } = montar();

    await controller.receber(
      SEGREDO,
      req,
      loteDeHistorico([
        doHistorico('5511999999999', 'respondi pelo celular', {
          key: {
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: true,
            id: 'id-minha',
          },
        }),
      ]),
    );

    const chamada = conversations.importarHistorico.mock.calls[0][0];
    expect(chamada.mensagens[0].daEmpresa).toBe(true);
  });

  it('descarta grupo e transmissão, como o caminho ao vivo', async () => {
    const { controller, conversations, req } = montar();

    await controller.receber(
      SEGREDO,
      req,
      loteDeHistorico([
        doHistorico('5511999999999', 'individual'),
        {
          key: {
            remoteJid: '120363000000000000@g.us',
            fromMe: false,
            id: 'id-grupo',
          },
          messageTimestamp: 1755300000,
          message: { conversation: 'mensagem de grupo' },
        },
      ]),
    );

    expect(conversations.importarHistorico).toHaveBeenCalledTimes(1);
    expect(
      conversations.importarHistorico.mock.calls[0][0].customerPhone,
    ).toBe('5511999999999');
  });

  it('mensagem sem data fica de fora', async () => {
    // Carimbá-la de "agora" jogaria uma conversa de meses atrás pro topo
    // do Inbox como se fosse atendimento novo.
    const { controller, conversations, req } = montar();

    await controller.receber(
      SEGREDO,
      req,
      loteDeHistorico([
        doHistorico('5511999999999', 'sem hora', { messageTimestamp: 0 }),
      ]),
    );

    expect(conversations.importarHistorico).not.toHaveBeenCalled();
  });

  it('um contato problemático não derruba o lote inteiro', async () => {
    const { controller, conversations, req } = montar();
    conversations.importarHistorico
      .mockRejectedValueOnce(new Error('telefone impossível'))
      .mockResolvedValueOnce(1);

    await expect(
      controller.receber(
        SEGREDO,
        req,
        loteDeHistorico([
          doHistorico('5511999999999', 'primeiro'),
          doHistorico('5527888888888', 'segundo'),
        ]),
      ),
    ).resolves.toEqual({ ok: true });

    expect(conversations.importarHistorico).toHaveBeenCalledTimes(2);
  });

  it('o último lote encerra a importação', async () => {
    const { controller, prisma, req } = montar();

    await controller.receber(
      SEGREDO,
      req,
      loteDeHistorico([], { isLatest: true }),
    );

    expect(prisma.client.evolutionSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ historicoEstado: 'CONCLUIDO' }),
      }),
    );
  });

  it('parear abre a janela de importação', async () => {
    const { controller, prisma, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'connection.update',
      instance: 'inteliwa-1',
      data: { state: 'open' },
    });

    expect(prisma.client.evolutionSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          historicoEstado: 'IMPORTANDO',
          historicoMensagens: 0,
        }),
      }),
    );
  });
});

/**
 * `connecting` não é "aguardando parear" numa sessão que já pareou.
 *
 * A Evolution manda esse estado toda vez que o socket sobe — inclusive
 * logo depois do `open` do pareamento por código, e a cada reconexão do
 * servidor. Traduzir isso pra AGUARDANDO_QRCODE rebaixava uma sessão
 * VIVA: o painel exibia "aguardando a leitura do QR code", travava o
 * compositor e mandava reconectar o que nunca tinha caído.
 */
describe('reconexão não derruba sessão de pé', () => {
  const conexao = (state: string) => ({
    event: 'connection.update',
    instance: 'inteliwa-1',
    data: { state },
  });

  it('mantém o estado quando o socket reconecta numa sessão já pareada', async () => {
    const { controller, prisma, realtime, req } = montar();
    prisma.client.evolutionSettings.findFirst.mockResolvedValue({
      id: 'config-1',
      tenantId: 'tenant-1',
      instance: 'inteliwa-1',
      webhookSecret: SEGREDO,
      lastSeenAt: new Date('2026-08-17T04:00:00Z'),
    });

    await controller.receber(SEGREDO, req, conexao('connecting'));

    expect(prisma.client.evolutionSettings.update).not.toHaveBeenCalled();
    // Nem o aviso na tela: era ele que travava o teclado do atendente.
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });

  it('quem NUNCA pareou continua vendo "aguardando QR code"', async () => {
    // Aqui o estado é verdadeiro: não há sessão, e é preciso parear.
    const { controller, prisma, req } = montar();

    await controller.receber(SEGREDO, req, conexao('connecting'));

    expect(prisma.client.evolutionSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'AGUARDANDO_QRCODE' }),
      }),
    );
  });

  it('o pareamento abre a janela de importação', async () => {
    // Quem estava esperando leitura acabou de parear: é aqui, e só aqui,
    // que o aparelho despeja o que já existia nele.
    const { controller, prisma, req } = montar();
    prisma.client.evolutionSettings.findFirst.mockResolvedValue({
      id: 'config-1',
      tenantId: 'tenant-1',
      instance: 'inteliwa-1',
      webhookSecret: SEGREDO,
      lastSeenAt: null,
      estado: 'AGUARDANDO_QRCODE',
    });

    await controller.receber(SEGREDO, req, conexao('open'));

    expect(prisma.client.evolutionSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'CONECTADO',
          historicoEstado: 'IMPORTANDO',
          historicoMensagens: 0,
        }),
      }),
    );
  });

  it('o socket voltando NÃO reabre a importação', async () => {
    /*
     * `open` chega toda vez que o socket sobe — oscilação de rede,
     * reinício do servidor, várias vezes por dia. Reabrindo a janela em
     * todos eles, o painel voltava a dizer "trazendo as conversas", com o
     * contador zerado, numa sessão que já tinha trazido tudo — e ficava
     * assim os dez minutos da paciência, sem nenhum lote pra chegar.
     */
    const { controller, prisma, req } = montar();
    prisma.client.evolutionSettings.findFirst.mockResolvedValue({
      id: 'config-1',
      tenantId: 'tenant-1',
      instance: 'inteliwa-1',
      webhookSecret: SEGREDO,
      lastSeenAt: new Date('2026-08-17T04:00:00Z'),
      estado: 'CONECTADO',
    });

    await controller.receber(SEGREDO, req, conexao('open'));

    const escrito = prisma.client.evolutionSettings.update.mock.calls[0][0].data;
    expect(escrito).toMatchObject({ estado: 'CONECTADO' });
    expect(escrito).not.toHaveProperty('historicoEstado');
    expect(escrito).not.toHaveProperty('historicoMensagens');
  });

  it('a queda de verdade continua chegando', async () => {
    // O guarda vale só pro `connecting`. Se a sessão cair mesmo, o
    // `close` chega e o aviso tem que aparecer — senão o defeito vira o
    // oposto: mensagem sumindo em silêncio.
    const { controller, prisma, req } = montar();
    prisma.client.evolutionSettings.findFirst.mockResolvedValue({
      id: 'config-1',
      tenantId: 'tenant-1',
      instance: 'inteliwa-1',
      webhookSecret: SEGREDO,
      lastSeenAt: new Date('2026-08-17T04:00:00Z'),
    });

    await controller.receber(SEGREDO, req, conexao('close'));

    expect(prisma.client.evolutionSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'DESCONECTADO' }),
      }),
    );
  });
});

describe('estado torto se conserta sozinho', () => {
  it('mensagem chegando destrava a sessão marcada como aguardando QR code', async () => {
    // O caso real: a sessão pareou por código, um `connecting` atrasado
    // rebaixou o estado, e o painel ficou com o teclado travado enquanto
    // o WhatsApp entregava normalmente do outro lado.
    const { controller, prisma, realtime, req } = montar();
    prisma.client.evolutionSettings.findFirst.mockResolvedValue({
      id: 'config-1',
      tenantId: 'tenant-1',
      instance: 'inteliwa-1',
      webhookSecret: SEGREDO,
      lastSeenAt: new Date(),
      estado: 'AGUARDANDO_QRCODE',
    });

    await controller.receber(SEGREDO, req, mensagem());

    expect(prisma.client.evolutionSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'CONECTADO', lastError: null }),
      }),
    );
    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'canal.estado',
      { estado: 'CONECTADO', lastError: null },
    );
  });

  it('não escreve à toa quando o estado já está certo', async () => {
    // Toda mensagem passa por aqui: uma escrita por mensagem recebida
    // seria um custo permanente pra consertar um caso raro.
    const { controller, prisma, req } = montar();

    await controller.receber(SEGREDO, req, mensagem());

    expect(prisma.client.evolutionSettings.update).not.toHaveBeenCalled();
  });
});

/**
 * O nome que aparece no painel.
 *
 * Duas fontes, e a diferença entre elas é a causa de um defeito real: em
 * TODA mensagem vem o nome de exibição de quem a escreveu, e nas que a
 * empresa mandou esse nome é o dela — que o WhatsApp entrega como
 * "Você". A agenda do aparelho é a outra fonte, e é a boa.
 */
describe('nome do cliente', () => {
  const doHistorico = (
    telefone: string,
    texto: string,
    extra: Record<string, unknown> = {},
  ) => ({
    key: {
      remoteJid: `${telefone}@s.whatsapp.net`,
      fromMe: false,
      id: `id-${texto.replace(/\W/g, '')}`,
    },
    messageTimestamp: 1755300000,
    message: { conversation: texto },
    ...extra,
  });

  it('não batiza o cliente de "Você" com o nome que veio de mensagem NOSSA', async () => {
    const { controller, conversations, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'messaging-history.set',
      instance: 'inteliwa-1',
      data: {
        messages: [
          // A primeira do lote é da empresa — e é aqui que vinha "Você".
          doHistorico('5511999999999', 'bom dia, em que posso ajudar?', {
            key: {
              remoteJid: '5511999999999@s.whatsapp.net',
              fromMe: true,
              id: 'id-nossa',
            },
            pushName: 'Você',
          }),
          doHistorico('5511999999999', 'oi, queria um orçamento', {
            pushName: 'Richard',
          }),
        ],
      },
    });

    const chamada = conversations.importarHistorico.mock.calls[0][0];
    expect(chamada.customerName).toBe('Richard');
  });
});

/**
 * A agenda chega por dois caminhos, e os dois têm que descer no mesmo
 * lugar.
 *
 * O QUE fazer com cada contato — qual nome vale, quem vira cliente — é
 * regra de cliente e mora em CustomersService (ver customers.agenda.spec).
 * Aqui só se garante o encaminhamento: nenhum dos dois caminhos pode
 * silenciosamente parar de entregar a agenda, que foi exatamente o
 * sintoma de quem conectou e não viu contato nenhum.
 */
describe('a agenda chega ao painel', () => {
  it('pelo evento de contatos', async () => {
    const { controller, customers, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'contacts.upsert',
      instance: 'inteliwa-1',
      data: [
        { remoteJid: '5511999999999@s.whatsapp.net', pushName: 'Richard' },
      ] as never,
    });

    expect(customers.importarAgenda).toHaveBeenCalledWith([
      { remoteJid: '5511999999999@s.whatsapp.net', pushName: 'Richard' },
    ]);
  });

  it('e junto do histórico, no mesmo lote das mensagens', async () => {
    // Descartá-la ali era jogar fora, de graça, a única fonte do nome de
    // verdade das pessoas.
    const { controller, customers, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'messaging-history.set',
      instance: 'inteliwa-1',
      data: {
        messages: [],
        contacts: [{ id: '5511999999999@s.whatsapp.net', name: 'Richard' }],
      },
    });

    expect(customers.importarAgenda).toHaveBeenCalledWith([
      { id: '5511999999999@s.whatsapp.net', name: 'Richard' },
    ]);
  });

  it('lote vazio não vira chamada', async () => {
    const { controller, customers, req } = montar();

    await controller.receber(SEGREDO, req, {
      event: 'contacts.upsert',
      instance: 'inteliwa-1',
      data: [] as never,
    });

    expect(customers.importarAgenda).not.toHaveBeenCalled();
  });
});
