import { ForbiddenException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

/**
 * A porta de entrada de TODA mensagem de cliente da plataforma.
 *
 * É a única rota pública que escreve no banco, e ela é multi-tenant: a Meta
 * chama a mesma URL pra todas as empresas. Duas coisas não podem falhar
 * aqui — descobrir de qual empresa é a entrega, e provar que ela veio mesmo
 * da Meta. Sem a segunda, qualquer pessoa que descubra a URL escreve
 * mensagem na conversa de qualquer cliente.
 */
const SEGREDO = 'app-secret-da-empresa';

function montar(
  settings: Record<string, unknown> | null = {
    id: 'cfg-1',
    tenantId: 'tenant-a',
    appSecretEncrypted: 'cifrado',
  },
) {
  const prisma = {
    client: {
      whatsAppSettings: {
        findFirst: jest.fn().mockResolvedValue(settings),
        update: jest.fn().mockResolvedValue({}),
      },
    },
  };
  const conversations = {
    receiveInbound: jest.fn().mockResolvedValue({}),
    applyDeliveryStatus: jest.fn().mockResolvedValue(undefined),
    applyReaction: jest.fn().mockResolvedValue(undefined),
    recordOutboundEcho: jest.fn().mockResolvedValue(null),
    importarHistorico: jest.fn().mockResolvedValue(0),
  };
  const customers = { upsertFromAddressBook: jest.fn().mockResolvedValue({}) };
  const media = { arquivar: jest.fn().mockResolvedValue(undefined) };
  const encryption = { decrypt: jest.fn().mockReturnValue(SEGREDO) };

  const controller = new WhatsappWebhookController(
    prisma as never,
    conversations as never,
    customers as never,
    media as never,
    encryption as never,
  );

  return { controller, prisma, conversations, customers };
}

/** Monta a requisição como a Meta manda: corpo bruto + assinatura HMAC. */
function requisicao(corpo: unknown, segredo: string | null = SEGREDO) {
  const rawBody = Buffer.from(JSON.stringify(corpo));
  const headers: Record<string, string> = {};
  if (segredo !== null) {
    headers['x-hub-signature-256'] =
      'sha256=' + createHmac('sha256', segredo).update(rawBody).digest('hex');
  }
  return { req: { rawBody, headers } as never, body: corpo as never };
}

const entregaCom = (value: Record<string, unknown>) => ({
  entry: [
    {
      id: 'waba-1',
      changes: [
        { value: { metadata: { phone_number_id: 'phone-1' }, ...value } },
      ],
    },
  ],
});

describe('verificação da URL (handshake da Meta)', () => {
  it('devolve o challenge quando o token bate', () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'token-certo';
    const { controller } = montar();

    expect(controller.verify('subscribe', 'token-certo', 'desafio-123')).toBe(
      'desafio-123',
    );
  });

  it('recusa token errado', () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'token-certo';
    const { controller } = montar();

    expect(() => controller.verify('subscribe', 'chute', 'desafio')).toThrow(
      ForbiddenException,
    );
  });
});

describe('assinatura', () => {
  const mensagem = entregaCom({
    messages: [
      {
        from: '5527999998888',
        id: 'wamid.1',
        type: 'text',
        text: { body: 'Oi' },
      },
    ],
  });

  it('aceita a entrega assinada com o segredo da empresa', async () => {
    const { controller, conversations } = montar();
    const { req, body } = requisicao(mensagem);

    await controller.receive(req, body);

    expect(conversations.receiveInbound).toHaveBeenCalled();
  });

  it('recusa assinatura de outro segredo', async () => {
    const { controller, conversations } = montar();
    const { req, body } = requisicao(mensagem, 'segredo-do-atacante');

    await expect(controller.receive(req, body)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(conversations.receiveInbound).not.toHaveBeenCalled();
  });

  it('recusa entrega sem assinatura nenhuma', async () => {
    const { controller } = montar();
    const { req, body } = requisicao(mensagem, null);

    await expect(controller.receive(req, body)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('descoberta do tenant', () => {
  it('phone_number_id desconhecido responde 200 e não escreve nada', async () => {
    // Responder erro faria a Meta reenviar e, insistindo, desativar o
    // webhook — derrubando o recebimento de TODAS as empresas.
    const { controller, conversations } = montar(null);
    const { req, body } = requisicao(
      entregaCom({
        messages: [
          {
            from: '5527999998888',
            id: 'w.1',
            type: 'text',
            text: { body: 'Oi' },
          },
        ],
      }),
    );

    await expect(controller.receive(req, body)).resolves.toEqual({ ok: true });
    expect(conversations.receiveInbound).not.toHaveBeenCalled();
  });

  it('entrega sem phone_number_id é ignorada em silêncio', async () => {
    const { controller, prisma } = montar();
    const { req, body } = requisicao({
      entry: [{ id: 'waba-1', changes: [{ value: {} }] }],
    });

    await expect(controller.receive(req, body)).resolves.toEqual({ ok: true });
    expect(prisma.client.whatsAppSettings.findFirst).not.toHaveBeenCalled();
  });
});

describe('mensagens recebidas', () => {
  it('usa o nome do perfil de CADA remetente, não o do primeiro', async () => {
    // O defeito: dois clientes na mesma entrega e um deles entrava no
    // sistema com o nome do outro.
    const { controller, conversations } = montar();
    const { req, body } = requisicao(
      entregaCom({
        contacts: [
          { wa_id: '5527999998888', profile: { name: 'Ana' } },
          { wa_id: '5527888887777', profile: { name: 'Bruno' } },
        ],
        messages: [
          {
            from: '5527999998888',
            id: 'w.1',
            type: 'text',
            text: { body: 'Oi' },
          },
          {
            from: '5527888887777',
            id: 'w.2',
            type: 'text',
            text: { body: 'Olá' },
          },
        ],
      }),
    );

    await controller.receive(req, body);

    expect(conversations.receiveInbound).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        customerPhone: '5527999998888',
        customerName: 'Ana',
      }),
    );
    expect(conversations.receiveInbound).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        customerPhone: '5527888887777',
        customerName: 'Bruno',
      }),
    );
  });

  it('sem nome no perfil, o telefone serve de rótulo', async () => {
    const { controller, conversations } = montar();
    const { req, body } = requisicao(
      entregaCom({
        messages: [
          {
            from: '5527999998888',
            id: 'w.1',
            type: 'text',
            text: { body: 'Oi' },
          },
        ],
      }),
    );

    await controller.receive(req, body);

    expect(conversations.receiveInbound).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: '5527999998888' }),
    );
  });

  it('reação modifica a mensagem reagida, não vira linha nova no histórico', async () => {
    const { controller, conversations } = montar();
    const { req, body } = requisicao(
      entregaCom({
        messages: [
          {
            from: '5527999998888',
            id: 'w.1',
            type: 'reaction',
            reaction: { message_id: 'wamid.original', emoji: '👍' },
          },
        ],
      }),
    );

    await controller.receive(req, body);

    expect(conversations.applyReaction).toHaveBeenCalledWith(
      'wamid.original',
      '👍',
      '5527999998888',
    );
    expect(conversations.receiveInbound).not.toHaveBeenCalled();
  });
});

describe('status de entrega', () => {
  const statusDe = (id: string, status: string) => ({
    id,
    status,
    recipient_id: '55279',
  });

  it('aplica os status quando a entrega só traz status', async () => {
    const { controller, conversations } = montar();
    const { req, body } = requisicao(
      entregaCom({ statuses: [statusDe('wamid.1', 'read')] }),
    );

    await controller.receive(req, body);

    expect(conversations.applyDeliveryStatus).toHaveBeenCalledWith(
      'wamid.1',
      'READ',
    );
  });

  it('aplica os status TAMBÉM quando vêm junto com mensagens', async () => {
    // O defeito: um `return` antecipado descartava os status desse lote em
    // silêncio, e a mensagem ficava com um tique só pra sempre.
    const { controller, conversations } = montar();
    const { req, body } = requisicao(
      entregaCom({
        statuses: [statusDe('wamid.1', 'delivered')],
        messages: [
          {
            from: '5527999998888',
            id: 'w.2',
            type: 'text',
            text: { body: 'Oi' },
          },
        ],
      }),
    );

    await controller.receive(req, body);

    expect(conversations.applyDeliveryStatus).toHaveBeenCalledWith(
      'wamid.1',
      'DELIVERED',
    );
    expect(conversations.receiveInbound).toHaveBeenCalled();
  });

  it('status que não conhecemos é ignorado sem quebrar a entrega', async () => {
    const { controller, conversations } = montar();
    const { req, body } = requisicao(
      entregaCom({ statuses: [statusDe('wamid.1', 'inventado')] }),
    );

    await expect(controller.receive(req, body)).resolves.toEqual({ ok: true });
    expect(conversations.applyDeliveryStatus).not.toHaveBeenCalled();
  });
});

describe('coexistência', () => {
  it('resposta dada pelo celular é registrada como eco, não como mensagem nova', async () => {
    const { controller, conversations } = montar();
    const { req, body } = requisicao(
      entregaCom({
        message_echoes: [
          {
            to: '5527999998888',
            id: 'wamid.eco',
            type: 'text',
            text: { body: 'Já vi aqui' },
          },
        ],
      }),
    );

    await controller.receive(req, body);

    expect(conversations.recordOutboundEcho).toHaveBeenCalledWith(
      expect.objectContaining({
        customerPhone: '5527999998888',
        content: 'Já vi aqui',
        externalId: 'wamid.eco',
      }),
    );
    expect(conversations.receiveInbound).not.toHaveBeenCalled();
  });

  it('apagar e editar feitos no celular não mexem no histórico daqui', async () => {
    const { controller, conversations } = montar();
    const { req, body } = requisicao(
      entregaCom({
        message_echoes: [
          { to: '5527999998888', id: 'wamid.x', type: 'revoke' },
        ],
      }),
    );

    await controller.receive(req, body);

    expect(conversations.recordOutboundEcho).not.toHaveBeenCalled();
  });

  it('contato saindo da agenda não apaga o cliente daqui', async () => {
    // Ele pode ter histórico de atendimento; perder isso por uma faxina na
    // agenda do celular seria perda de dado.
    const { controller, customers } = montar();
    const { req, body } = requisicao(
      entregaCom({
        state_sync: [
          {
            type: 'contact',
            action: 'remove',
            contact: { phone_number: '5527999998888' },
          },
        ],
      }),
    );

    await controller.receive(req, body);

    expect(customers.upsertFromAddressBook).not.toHaveBeenCalled();
  });

  it('contato adicionado na agenda entra no sistema', async () => {
    const { controller, customers } = montar();
    const { req, body } = requisicao(
      entregaCom({
        state_sync: [
          {
            type: 'contact',
            action: 'add',
            contact: { phone_number: '5527999998888', full_name: 'Ana Souza' },
          },
        ],
      }),
    );

    await controller.receive(req, body);

    expect(customers.upsertFromAddressBook).toHaveBeenCalledWith({
      phone: '5527999998888',
      name: 'Ana Souza',
    });
  });
});
