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
        // Devolve a linha ATUALIZADA, como o Prisma faz. Importa porque o
        // nome da sessão é trocado nesse mesmo update, e o resto do
        // método usa o valor devolvido pra falar com o servidor.
        update: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) => ({
            ...criado,
            ...args.data,
          })),
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

  // A agenda é lida ao conectar; nestes testes ela só não pode atrapalhar.
  const customers = {
    importarAgenda: jest.fn().mockResolvedValue({ recebidos: 0, salvos: 0 }),
  };

  const service = new EvolutionService(
    prisma as unknown as TenantPrismaService,
    global as unknown as PrismaService,
    encryption as unknown as EncryptionService,
    customers as never,
  );

  return { service, prisma, global, customers };
}

/**
 * O servidor Evolution de mentira.
 *
 * `sessaoJaExiste` reproduz o 403 de "instance already exists", que é o
 * que acontece em TODA reconexão — e é justamente onde o registro do
 * webhook se perdia.
 */
function servidor({
  sessaoJaExiste = false,
  /** Trecho de URL que o servidor de mentira vai recusar com 404. */
  recusa = '',
} = {}) {
  const chamadas: { url: string; corpo: Record<string, unknown> }[] = [];

  global.fetch = jest.fn(async (url: unknown, init: unknown) => {
    const opcoes = init as { body?: string };
    const endereco = String(url);
    chamadas.push({
      url: endereco,
      corpo: opcoes.body ? JSON.parse(opcoes.body) : {},
    });

    if (recusa && endereco.includes(recusa)) {
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ message: 'not found' }),
      } as Response;
    }

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
  const antes = { ...process.env };
  beforeEach(() => {
    // O servidor de mensagens vem do ambiente da API, não do cliente
    // (ver evolution-servidor.ts).
    process.env.EVOLUTION_BASE_URL = 'https://evo.exemplo.com';
    process.env.EVOLUTION_API_KEY = 'chave-da-plataforma';
  });
  afterEach(() => {
    process.env = { ...antes };
  });

  it('inclui o prefixo global da API', async () => {
    // Toda a API vive sob /api. Sem o prefixo, o endereço registrado
    // aponta pra uma rota que não existe: a Evolution entrega tudo em 404
    // e o painel fica mudo, com a sessão conectada.
    process.env.API_PUBLIC_URL = 'https://api.exemplo.com';
    const chamadas = servidor();
    const { service } = montar();

    await service.conectar();

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

    await service.conectar();

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
      service.conectar(),
    ).rejects.toThrow(/endereço de retorno/);
  });

  it('não deixa barra dobrada quando o endereço termina em barra', async () => {
    process.env.API_PUBLIC_URL = 'https://api.exemplo.com/';
    const chamadas = servidor();
    const { service } = montar();

    await service.conectar();

    expect(webhookRegistrado(chamadas)).toMatchObject({
      url: expect.not.stringContaining('com//'),
    });
  });

  it('completa o https:// que o Railway não mostra', async () => {
    // O painel exibe o domínio pelado, e é assim que ele é copiado. Sem
    // esquema o destino não é chamável, e o sintoma é o de sempre: tudo
    // conectado e nenhuma mensagem no painel.
    process.env.API_PUBLIC_URL = 'api-production-7156.up.railway.app';
    const chamadas = servidor();
    const { service } = montar();

    await service.conectar();

    expect(webhookRegistrado(chamadas)?.url).toBe(
      `https://api-production-7156.up.railway.app/api/webhooks/evolution/${'a'.repeat(48)}`,
    );
  });




  it('estreia um nome de sessão novo a cada pareamento', async () => {
    // O servidor só pede um código ao WhatsApp quando o socket sobe;
    // depois devolve o que está na memória dele — o mesmo código vencido.
    // Nome novo é o que garante socket novo, e sem colidir com o velho
    // (recriar com o MESMO nome deixa um socket órfão gravando em
    // registro apagado, e o pareamento nunca completa).
    process.env.API_PUBLIC_URL = 'https://api.exemplo.com';
    const chamadas = servidor({ sessaoJaExiste: false });
    const { service, prisma } = montar({
      baseUrl: 'https://evo.exemplo.com',
      instance: 'inteliwa-velha',
      estado: 'AGUARDANDO_QRCODE',
      pairingCode: 'VENCIDO1',
      updatedAt: new Date(Date.now() - 5 * 60_000),
    });

    await service.conectar('5527998836017');

    const criacao = chamadas.find((c) => c.url.includes('/instance/create'));
    expect(criacao?.corpo.instanceName).not.toBe('inteliwa-velha');
    expect(prisma.db.evolutionSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ instance: expect.any(String) }),
      }),
    );
  });

  it('devolve o pareamento recém emitido em vez de trocar de sessão', async () => {
    // Sem isto, um segundo clique — ou a tela consultando o estado —
    // trocaria a sessão por baixo do código que a pessoa está digitando.
    process.env.API_PUBLIC_URL = 'https://api.exemplo.com';
    const chamadas = servidor();
    const { service } = montar({
      baseUrl: 'https://evo.exemplo.com',
      instance: 'inteliwa-1',
      estado: 'AGUARDANDO_QRCODE',
      pairingCode: '3Z243KXG',
      updatedAt: new Date(),
    });

    await expect(service.conectar('5527998836017')).resolves.toMatchObject({
      pairingCode: '3Z243KXG',
    });
    expect(chamadas).toHaveLength(0);
  });

  it('recusa conectar sem o endereço público configurado', async () => {
    // Melhor falhar na cara de quem clicou que registrar um webhook
    // apontando pra localhost e descobrir horas depois.
    delete process.env.API_PUBLIC_URL;
    servidor();
    const { service } = montar();

    await expect(
      service.conectar(),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('reconexão', () => {
  const antes = { ...process.env };
  beforeEach(() => {
    process.env.API_PUBLIC_URL = 'https://api.exemplo.com';
    // O servidor de mensagens é da plataforma, e vem do ambiente da API
    // (ver evolution-servidor.ts) — o cliente não informa nada.
    process.env.EVOLUTION_BASE_URL = 'https://evo.exemplo.com';
    process.env.EVOLUTION_API_KEY = 'chave-da-plataforma';
  });
  afterEach(() => {
    process.env = { ...antes };
  });

  it('reconectar não pede nada a ninguém', async () => {
    // A tela chegou a pedir endereço e chave, e a reconexão ficava
    // impossível de acionar: o campo era apagado ao salvar, então quem já
    // tinha conectado não tinha mais o segredo na mão.
    const chamadas = servidor({ sessaoJaExiste: true });
    const { service } = montar({ baseUrl: 'https://evo.exemplo.com' });

    await expect(service.conectar()).resolves.toBeDefined();
    expect(chamadas.some((c) => c.url.includes('/webhook/set/'))).toBe(true);
  });

  it('recusa com clareza quando a plataforma não tem servidor configurado', async () => {
    // Sem as variáveis de ambiente, o recurso simplesmente não existe
    // nesta instalação — melhor dizer isso do que estourar no meio do
    // caminho com um erro de rede.
    delete process.env.EVOLUTION_BASE_URL;
    delete process.env.EVOLUTION_API_KEY;
    servidor();
    const { service } = montar(null);

    await expect(service.conectar()).rejects.toThrow(BadRequestException);
  });

  it('não fica esperando QR code numa sessão que já está de pé', async () => {
    // Reconectar numa sessão aberta não devolve QR nenhum — não há o que
    // parear. Assumir "aguardando" deixava a tela girando pra sempre.
    global.fetch = jest.fn(async (url: unknown) => {
      const endereco = String(url);
      if (endereco.includes('/instance/create')) {
        return { ok: false, status: 403, text: async () => '{}' } as Response;
      }
      if (endereco.includes('/instance/connectionState/')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ instance: { state: 'open' } }),
        } as Response;
      }
      return { ok: true, status: 200, text: async () => '{}' } as Response;
    }) as unknown as typeof fetch;

    const { service } = montar({ baseUrl: 'https://evo.exemplo.com' });

    await expect(service.conectar()).resolves.toMatchObject({
      estado: 'CONECTADO',
      qrCode: null,
    });
  });
});

describe('troca de canal', () => {
  const antes = { ...process.env };
  beforeEach(() => {
    process.env.API_PUBLIC_URL = 'https://api.exemplo.com';
    // O servidor de mensagens é da plataforma, e vem do ambiente da API
    // (ver evolution-servidor.ts) — o cliente não informa nada.
    process.env.EVOLUTION_BASE_URL = 'https://evo.exemplo.com';
    process.env.EVOLUTION_API_KEY = 'chave-da-plataforma';
  });
  afterEach(() => {
    process.env = { ...antes };
  });

  it('passa a empresa pra Evolution assim que a sessão existe', async () => {
    // E não quando o QR code é lido: se esperasse a conexão, as mensagens
    // do intervalo sairiam pela Meta — o canal que a empresa está deixando.
    servidor();
    const { service, global: g } = montar();

    await service.conectar();

    expect(g.client.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { canal: 'EVOLUTION' } }),
    );
  });

  it('assina só os eventos que o sistema processa', async () => {
    // Assinar tudo faria o servidor despejar presença, digitação e cada
    // troca de foto de perfil no nosso webhook — tráfego que só custa.
    const chamadas = servidor();
    const { service } = montar();

    await service.conectar();

    expect(webhookRegistrado(chamadas)?.events).toEqual([
      'MESSAGES_UPSERT',
      'MESSAGES_UPDATE',
      'CONNECTION_UPDATE',
      'QRCODE_UPDATED',
      'MESSAGES_SET',
      'MESSAGES_DELETE',
      // A agenda do aparelho. É dela que sai o nome de verdade do
      // cliente — sem ela, o painel mostra o apelido que a pessoa
      // escolheu, ou o telefone cru quando ela não escolheu nada.
      'CONTACTS_SET',
      'CONTACTS_UPSERT',
      'CONTACTS_UPDATE',
    ]);
  });

  it('desiste dos contatos antes de desistir das mensagens', async () => {
    /*
     * O servidor confere a lista contra um enum e recusa a chamada
     * INTEIRA quando encontra um nome que não conhece. Como esse conjunto
     * muda entre versões da Evolution, insistir nos eventos de contato
     * trocaria "o painel mostra telefone em vez de nome" por "o painel
     * não recebe mensagem nenhuma".
     *
     * O servidor de mentira aqui recusa só a primeira tentativa, que é o
     * que uma versão antiga faria.
     */
    let tentativas = 0;
    const chamadas: { url: string; corpo: Record<string, unknown> }[] = [];
    global.fetch = jest.fn(async (url: unknown, init: unknown) => {
      const opcoes = init as { body?: string };
      const endereco = String(url);
      const corpo = opcoes.body
        ? (JSON.parse(opcoes.body) as Record<string, unknown>)
        : {};
      chamadas.push({ url: endereco, corpo });

      if (endereco.includes('/webhook/set/')) {
        tentativas += 1;
        if (tentativas === 1) {
          return {
            ok: false,
            status: 400,
            text: async () =>
              JSON.stringify({ message: 'events must be a valid enum value' }),
          } as Response;
        }
      }

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ qrcode: { base64: 'data:image/png;base64,AA' } }),
      } as Response;
    }) as unknown as typeof fetch;

    const { service } = montar();
    await expect(service.conectar()).resolves.toBeDefined();

    // A segunda tentativa sobe SEM os contatos, e é ela que vale.
    const registros = chamadas.filter((c) => c.url.includes('/webhook/set/'));
    expect(registros).toHaveLength(2);
    const eventos = (registros[1].corpo as { webhook?: { events?: string[] } })
      .webhook?.events;
    expect(eventos).not.toContain('CONTACTS_UPSERT');
    expect(eventos).toContain('MESSAGES_UPSERT');
  });

  it('pede o histórico completo, e não só as mensagens novas', async () => {
    // O padrão do protocolo de aparelho vinculado é mandar só um punhado
    // das mais recentes. Sem este pedido, "trazendo as conversas" era uma
    // promessa que o servidor nunca tinha sido instruído a cumprir.
    const chamadas = servidor();
    const { service } = montar();

    await service.conectar();

    const ajuste = chamadas.find((c) => c.url.includes('/settings/set/'));
    expect(ajuste?.corpo).toMatchObject({ syncFullHistory: true });
  });

  it('a conexão sobe mesmo se o servidor recusar o pedido de histórico', async () => {
    // Versão antiga do servidor, rota diferente, o que for: sem histórico
    // o painel funciona e só começa vazio. Derrubar o pareamento inteiro
    // por causa disso trocaria um defeito por um maior.
    const chamadas = servidor({ recusa: '/settings/set/' });
    const { service } = montar();

    await expect(service.conectar()).resolves.toBeDefined();
    expect(chamadas.some((c) => c.url.includes('/settings/set/'))).toBe(true);
  });
});

describe('pareamento por código', () => {
  /**
   * No celular não dá pra escanear a própria tela. Quem abre o painel pelo
   * telefone — que é como boa parte do teste real acontece — precisava de
   * um segundo aparelho ou de um computador. O código de oito caracteres
   * resolve isso, e é a MESMA rota do QR code com o número junto.
   */
  const antes = { ...process.env };
  beforeEach(() => {
    process.env.API_PUBLIC_URL = 'https://api.exemplo.com';
    process.env.EVOLUTION_BASE_URL = 'https://evo.exemplo.com';
    process.env.EVOLUTION_API_KEY = 'chave-da-plataforma';
  });
  afterEach(() => {
    process.env = { ...antes };
  });

  it('manda só os dígitos do número pro servidor', async () => {
    // Um número com parênteses ou espaço gera um pareamento que o WhatsApp
    // aceita criar e nunca reconhece — a pessoa digita no celular e não
    // acontece nada, sem erro em lugar nenhum.
    const chamadas = servidor();
    const { service } = montar();

    await service.conectar('+55 (27) 99999-8888');

    const criacao = chamadas.find((c) => c.url.includes('/instance/create'));
    expect(criacao?.corpo).toMatchObject({ number: '5527999998888' });
  });

  it('sem número, continua pedindo QR code', async () => {
    const chamadas = servidor();
    const { service } = montar();

    await service.conectar();

    const criacao = chamadas.find((c) => c.url.includes('/instance/create'));
    expect(criacao?.corpo).not.toHaveProperty('number');
  });

  it('numa sessão que já existe, o número vai na consulta', async () => {
    // Criar dá 403 quando a sessão já está lá; o caminho vira
    // /instance/connect, e o número precisa acompanhar.
    const chamadas = servidor({ sessaoJaExiste: true });
    const { service } = montar({ baseUrl: 'https://evo.exemplo.com' });

    await service.conectar('5527999998888');

    const conexao = chamadas.find((c) => c.url.includes('/instance/connect/'));
    expect(conexao?.url).toContain('number=5527999998888');
  });

  it('esperar pareamento vale pro código, não só pra imagem', async () => {
    // Olhar só o QR code deixava a tela do código achando que nada
    // aconteceu — e ela ficaria parada num estado desconectado.
    global.fetch = jest.fn(async (url: unknown) => {
      const endereco = String(url);
      if (endereco.includes('/instance/create')) {
        return {
          ok: true,
          status: 201,
          text: async () => JSON.stringify({ pairingCode: 'WXYZ-1234' }),
        } as Response;
      }
      return { ok: true, status: 200, text: async () => '{}' } as Response;
    }) as unknown as typeof fetch;

    const { service } = montar();

    await expect(service.conectar('5527999998888')).resolves.toMatchObject({
      pairingCode: 'WXYZ-1234',
      estado: 'AGUARDANDO_QRCODE',
    });
  });
});
