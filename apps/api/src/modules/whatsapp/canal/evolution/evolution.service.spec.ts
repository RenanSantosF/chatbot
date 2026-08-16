import { BadRequestException } from '@nestjs/common';
import type { EncryptionService } from '../../../../common/crypto/encryption.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { TenantPrismaService } from '../../../../common/prisma/tenant-prisma.service';
import { EvolutionService } from './evolution.service';

/**
 * O endereço do webhook é o ponto único de falha silenciosa deste caminho.
 *
 * Ele é registrado no servidor de mensagens UMA vez, na hora de conectar, e
 * ninguém olha pra ele depois. Se sair errado, tudo o mais parece
 * funcionar — a sessão conecta, o QR code é aceito, o painel mostra
 * "Conectado" — e nenhuma mensagem chega, sem erro em lugar nenhum.
 */
function montar(config: Record<string, unknown> | null = null) {
  const criado = {
    id: 'evo-1',
    instance: 'inteliwa-1',
    webhookSecret: 'a'.repeat(48),
    ...config,
  };

  const prisma = {
    tenantId: 'tenant-1',
    db: {
      evolutionSettings: {
        findFirst: jest.fn().mockResolvedValue(config),
        create: jest.fn().mockResolvedValue(criado),
        update: jest.fn().mockResolvedValue(criado),
      },
    },
  };

  const global = {
    client: { tenant: { update: jest.fn().mockResolvedValue({}) } },
  };

  const encryption = {
    encrypt: jest.fn().mockReturnValue('cifrado'),
    decrypt: jest.fn().mockReturnValue('chave-crua'),
  };

  const service = new EvolutionService(
    prisma as unknown as TenantPrismaService,
    global as unknown as PrismaService,
    encryption as unknown as EncryptionService,
  );

  return { service, prisma, global };
}

/** O servidor Evolution de mentira: guarda o que recebeu e diz que deu certo. */
function servidor() {
  const chamadas: { url: string; corpo: Record<string, unknown> }[] = [];

  global.fetch = jest.fn(async (url: unknown, init: unknown) => {
    const opcoes = init as { body?: string };
    chamadas.push({
      url: String(url),
      corpo: opcoes.body ? JSON.parse(opcoes.body) : {},
    });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ qrcode: { base64: 'data:image/png;base64,AA' } }),
    } as Response;
  }) as unknown as typeof fetch;

  return chamadas;
}

describe('endereço do webhook', () => {
  const antes = process.env.API_PUBLIC_URL;
  afterEach(() => {
    process.env.API_PUBLIC_URL = antes;
  });

  it('inclui o prefixo global da API', async () => {
    // Toda a API vive sob /api. Sem o prefixo, o endereço registrado
    // aponta pra uma rota que não existe: a Evolution entrega tudo em 404
    // e o painel fica mudo, com a sessão conectada.
    process.env.API_PUBLIC_URL = 'https://api.exemplo.com';
    const chamadas = servidor();
    const { service } = montar();

    await service.conectar({ baseUrl: 'https://evo.exemplo.com', apiKey: 'chave' });

    expect(chamadas[0].corpo.webhook).toMatchObject({
      url: `https://api.exemplo.com/api/webhooks/evolution/${'a'.repeat(48)}`,
    });
  });

  it('não deixa barra dobrada quando o endereço termina em barra', async () => {
    process.env.API_PUBLIC_URL = 'https://api.exemplo.com/';
    const chamadas = servidor();
    const { service } = montar();

    await service.conectar({ baseUrl: 'https://evo.exemplo.com', apiKey: 'chave' });

    expect(chamadas[0].corpo.webhook).toMatchObject({
      url: expect.not.stringContaining('com//'),
    });
  });

  it('recusa conectar sem o endereço público configurado', async () => {
    // Melhor falhar na cara de quem clicou que registrar um webhook
    // apontando pra localhost e descobrir horas depois.
    delete process.env.API_PUBLIC_URL;
    servidor();
    const { service } = montar();

    await expect(
      service.conectar({ baseUrl: 'https://evo.exemplo.com', apiKey: 'chave' }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('troca de canal', () => {
  const antes = process.env.API_PUBLIC_URL;
  beforeEach(() => {
    process.env.API_PUBLIC_URL = 'https://api.exemplo.com';
  });
  afterEach(() => {
    process.env.API_PUBLIC_URL = antes;
  });

  it('passa a empresa pra Evolution assim que a sessão existe', async () => {
    // E não quando o QR code é lido: se esperasse a conexão, as mensagens
    // do intervalo sairiam pela Meta — o canal que a empresa está deixando.
    servidor();
    const { service, global: g } = montar();

    await service.conectar({ baseUrl: 'https://evo.exemplo.com', apiKey: 'chave' });

    expect(g.client.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { canal: 'EVOLUTION' } }),
    );
  });

  it('assina só os eventos que o sistema processa', async () => {
    // Assinar tudo faria o servidor despejar presença, digitação e cada
    // troca de foto de perfil no nosso webhook — tráfego que só custa.
    const chamadas = servidor();
    const { service } = montar();

    await service.conectar({ baseUrl: 'https://evo.exemplo.com', apiKey: 'chave' });

    expect((chamadas[0].corpo.webhook as { events: string[] }).events).toEqual([
      'MESSAGES_UPSERT',
      'MESSAGES_UPDATE',
      'CONNECTION_UPDATE',
      'QRCODE_UPDATED',
    ]);
  });
});
