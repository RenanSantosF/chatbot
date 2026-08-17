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

/**
 * O servidor Evolution de mentira.
 *
 * `sessaoJaExiste` reproduz o 403 de "instance already exists", que é o
 * que acontece em TODA reconexão — e é justamente onde o registro do
 * webhook se perdia.
 */
function servidor({ sessaoJaExiste = false } = {}) {
  const chamadas: { url: string; corpo: Record<string, unknown> }[] = [];

  global.fetch = jest.fn(async (url: unknown, init: unknown) => {
    const opcoes = init as { body?: string };
    const endereco = String(url);
    chamadas.push({
      url: endereco,
      corpo: opcoes.body ? JSON.parse(opcoes.body) : {},
    });

    if (sessaoJaExiste && endereco.includes('/instance/create')) {
      return {
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ message: 'instance already exists' }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ qrcode: { base64: 'data:image/png;base64,AA' } }),
    } as Response;
  }) as unknown as typeof fetch;

  return chamadas;
}

/** O endereço registrado, venha ele da criação ou da chamada própria. */
function webhookRegistrado(chamadas: { url: string; corpo: Record<string, unknown> }[]) {
  const set = chamadas.find((c) => c.url.includes('/webhook/set/'));
  return (set?.corpo as { webhook?: { url?: string; events?: string[] } })?.webhook;
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

    expect(webhookRegistrado(chamadas)).toMatchObject({
      url: `https://api.exemplo.com/api/webhooks/evolution/${'a'.repeat(48)}`,
    });
  });

  it('registra o endereço também quando a sessão já existe', async () => {
    // O caso de TODA reconexão. Criar leva o webhook junto; reconectar
    // numa sessão existente só pede o QR code — e sem uma chamada
    // própria, o endereço ficava o de antes, ou nenhum. Sintoma: tudo
    // conectado e silêncio absoluto no painel.
    process.env.API_PUBLIC_URL = 'https://api.exemplo.com';
    const chamadas = servidor({ sessaoJaExiste: true });
    const { service } = montar({ instance: 'inteliwa-1' });

    await service.conectar({ baseUrl: 'https://evo.exemplo.com', apiKey: 'chave' });

    expect(chamadas.some((c) => c.url.includes('/instance/connect/'))).toBe(true);
    expect(webhookRegistrado(chamadas)).toMatchObject({
      enabled: true,
      url: `https://api.exemplo.com/api/webhooks/evolution/${'a'.repeat(48)}`,
    });
  });

  it('recusa a conexão quando o endereço não foi aceito', async () => {
    // Uma sessão de pé sem endereço de retorno é pior que nenhuma: ela
    // conecta, recebe, e some com tudo em silêncio.
    process.env.API_PUBLIC_URL = 'https://api.exemplo.com';
    global.fetch = jest.fn(async (url: unknown) =>
      String(url).includes('/webhook/set/')
        ? ({ ok: false, status: 400, text: async () => '{"message":"invalid url"}' } as Response)
        : ({ ok: true, status: 200, text: async () => '{}' } as Response),
    ) as unknown as typeof fetch;
    const { service } = montar();

    await expect(
      service.conectar({ baseUrl: 'https://evo.exemplo.com', apiKey: 'chave' }),
    ).rejects.toThrow(/endereço de retorno/);
  });

  it('não deixa barra dobrada quando o endereço termina em barra', async () => {
    process.env.API_PUBLIC_URL = 'https://api.exemplo.com/';
    const chamadas = servidor();
    const { service } = montar();

    await service.conectar({ baseUrl: 'https://evo.exemplo.com', apiKey: 'chave' });

    expect(webhookRegistrado(chamadas)).toMatchObject({
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

    expect(webhookRegistrado(chamadas)?.events).toEqual([
      'MESSAGES_UPSERT',
      'MESSAGES_UPDATE',
      'CONNECTION_UPDATE',
      'QRCODE_UPDATED',
    ]);
  });
});
