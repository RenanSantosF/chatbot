import webpush from 'web-push';
import { PushService } from './push.service';

jest.mock('web-push', () => ({
  __esModule: true,
  default: { setVapidDetails: jest.fn(), sendNotification: jest.fn() },
}));

const enviar = webpush.sendNotification as jest.Mock;
const configurar = webpush.setVapidDetails as jest.Mock;
beforeEach(() => configurar.mockReset());

/**
 * O aviso que chega com o painel fechado.
 *
 * O que se testa aqui não é a entrega — quem entrega é o serviço de push
 * do navegador, fora do nosso alcance. É o comportamento em volta dela, e
 * ele importa por um motivo: isto roda dentro do caminho de RECEBER
 * mensagem do cliente, o mais crítico do sistema. Um erro que escape daqui
 * derruba a gravação de uma mensagem por causa de um aviso.
 */
function montar(inscricoes: { endpoint: string }[] = []) {
  const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    client: {
      pushSubscription: {
        findMany: jest.fn().mockResolvedValue(
          inscricoes.map((i) => ({ ...i, p256dh: 'chave', auth: 'segredo' })),
        ),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany,
      },
    },
  };
  return { service: new PushService(prisma as never), prisma, deleteMany };
}

const COM_VAPID = {
  VAPID_PUBLIC_KEY: 'publica-de-teste',
  VAPID_PRIVATE_KEY: 'privada-de-teste',
};

describe('sem VAPID configurado', () => {
  const original = { ...process.env };
  beforeEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    enviar.mockReset();
  });
  afterAll(() => Object.assign(process.env, original));

  it('o recurso fica desligado em vez de quebrar', async () => {
    // O resto do sistema tem que funcionar igual sem as chaves, como já
    // acontece com o armazenamento de anexos e com o ffmpeg.
    const { service, prisma } = montar([{ endpoint: 'a' }]);

    expect(service.chavePublica()).toBeNull();
    await service.avisarEquipe('t', { titulo: 'x', corpo: 'y', conversationId: 'c' });

    expect(prisma.client.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe('com VAPID configurado', () => {
  const original = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, COM_VAPID);
    enviar.mockReset();
    enviar.mockResolvedValue(undefined);
  });
  afterAll(() => Object.assign(process.env, original));

  it('avisa todos os aparelhos da empresa', async () => {
    // Um por aparelho, não um por pessoa: quem atende do computador e do
    // celular precisa ser avisado nos dois.
    const { service } = montar([{ endpoint: 'a' }, { endpoint: 'b' }]);

    await service.avisarEquipe('t', {
      titulo: 'Maria',
      corpo: 'Oi',
      conversationId: 'conversa-1',
    });

    expect(enviar).toHaveBeenCalledTimes(2);
    const carga = JSON.parse(enviar.mock.calls[0][1] as string) as {
      conversationId: string;
    };
    // O id da conversa vai junto porque é ele que faz o clique no aviso
    // abrir a conversa certa, e não a caixa genérica.
    expect(carga.conversationId).toBe('conversa-1');
  });

  it('apaga a inscrição que o serviço de push declara morta', async () => {
    // 404 e 410 querem dizer "este aparelho não existe mais" — app
    // desinstalado, dados do site limpos, chave rodada. Guardar essas
    // linhas faria a lista crescer pra sempre e cada aviso pagar por um
    // envio que nunca chega.
    const { service, deleteMany } = montar([{ endpoint: 'morta' }]);
    enviar.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));

    await service.avisarEquipe('t', { titulo: 'x', corpo: 'y', conversationId: 'c' });

    expect(deleteMany).toHaveBeenCalledWith({ where: { endpoint: 'morta' } });
  });

  it('falha passageira NÃO apaga a inscrição', async () => {
    // Serviço de push fora do ar não é aparelho inexistente. Apagar aqui
    // desinscreveria a equipe inteira num soluço da Google.
    const { service, deleteMany } = montar([{ endpoint: 'viva' }]);
    enviar.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));

    await service.avisarEquipe('t', { titulo: 'x', corpo: 'y', conversationId: 'c' });

    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('um aparelho que falha não impede os outros', async () => {
    const { service } = montar([{ endpoint: 'a' }, { endpoint: 'b' }]);
    enviar
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
      .mockResolvedValueOnce(undefined);

    await expect(
      service.avisarEquipe('t', { titulo: 'x', corpo: 'y', conversationId: 'c' }),
    ).resolves.toBeUndefined();

    expect(enviar).toHaveBeenCalledTimes(2);
  });

  it('sem ninguém inscrito, nem consulta o serviço de push', async () => {
    const { service } = montar([]);

    await service.avisarEquipe('t', { titulo: 'x', corpo: 'y', conversationId: 'c' });

    expect(enviar).not.toHaveBeenCalled();
  });

  it('reinscrever o mesmo aparelho atualiza, não duplica', async () => {
    // Sem o upsert pelo endpoint, cada abertura do painel criaria uma
    // linha nova e a pessoa receberia o mesmo aviso cinco vezes.
    const { service, prisma } = montar();

    await service.inscrever({
      tenantId: 't',
      userId: 'u',
      endpoint: 'https://exemplo/abc',
      p256dh: 'k',
      auth: 'a',
    });

    expect(prisma.client.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { endpoint: 'https://exemplo/abc' } }),
    );
  });
});

/**
 * Uma variável mal digitada não pode derrubar a API.
 *
 * Isto aconteceu de verdade, na primeira configuração em produção: o
 * `VAPID_SUBJECT` foi preenchido com o e-mail puro, sem `mailto:`, o
 * `setVapidDetails` lançou dentro do construtor, e o Nest abortou a
 * inicialização INTEIRA — nenhuma mensagem entrava mais no sistema por
 * causa de um recurso de notificação.
 */
describe('VAPID malformada', () => {
  const original = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, COM_VAPID);
    enviar.mockReset();
  });
  afterAll(() => Object.assign(process.env, original));

  it('não derruba a subida: desliga o push e segue', () => {
    process.env.VAPID_SUBJECT = 'isso-nao-e-url-nem-email';
    (webpush.setVapidDetails as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Vapid subject is not a valid URL.');
    });

    // O construtor tem que sobreviver. Antes, ele lançava daqui.
    const { service } = montar();

    expect(service.chavePublica()).toBeNull();
  });

  it('e-mail sem mailto: é completado em vez de recusado', () => {
    // Tem UMA leitura possível, e recusar custava a API no ar.
    process.env.VAPID_SUBJECT = 'renan@exemplo.com';

    montar();

    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      'mailto:renan@exemplo.com',
      expect.any(String),
      expect.any(String),
    );
  });

  it('mailto: já escrito passa intacto', () => {
    process.env.VAPID_SUBJECT = 'mailto:renan@exemplo.com';

    montar();

    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      'mailto:renan@exemplo.com',
      expect.any(String),
      expect.any(String),
    );
  });
});
