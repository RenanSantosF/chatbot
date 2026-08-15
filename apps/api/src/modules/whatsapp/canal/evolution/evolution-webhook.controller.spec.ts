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
  };

  const config = {
    id: 'config-1',
    tenantId: 'tenant-1',
    instance: 'inteliwa-1',
    webhookSecret: SEGREDO,
  };

  const prisma = {
    client: {
      evolutionSettings: {
        findFirst: jest.fn().mockResolvedValue(config),
        update: jest.fn().mockResolvedValue(config),
      },
    },
  };

  const controller = new EvolutionWebhookController(
    prisma as unknown as PrismaService,
    conversations as unknown as ConversationsService,
  );

  const req = {} as AuthenticatedRequest;
  return { controller, conversations, prisma, req };
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

  it('não cria cliente a partir de grupo nem de status', async () => {
    const { controller, conversations, req } = montar();

    for (const remoteJid of ['120363000@g.us', 'status@broadcast']) {
      await controller.receber(
        SEGREDO,
        req,
        mensagem({ key: { remoteJid, fromMe: false, id: 'X' } }),
      );
    }

    expect(conversations.receiveInbound).not.toHaveBeenCalled();
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
