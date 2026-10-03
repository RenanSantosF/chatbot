import * as evolution from '../whatsapp/canal/evolution/evolution.client';
import {
  TOLERANCIA_MS,
  VigiaDoWhatsappService,
} from './vigia-do-whatsapp.service';

/**
 * O aviso de WhatsApp caído.
 *
 * Duas coisas puxam pra lados opostos: avisar logo (cada minuto caído é
 * cliente sem resposta) e não avisar à toa (aviso por cada piscada ensina
 * o dono a ignorar o alarme). A tolerância de 5 minutos e o "uma vez por
 * queda" são o meio-termo — e é isso que estes testes guardam.
 */
const AGORA = new Date('2026-10-05T03:00:00Z');
const minutosAtras = (min: number) =>
  new Date(AGORA.getTime() - min * 60 * 1000);

function vigiaCom(
  sessao: Partial<{
    estado: string;
    lastError: string | null;
    quedaDesde: Date | null;
    quedaAvisadaEm: Date | null;
  }>,
) {
  const linha = {
    id: 'evo-1',
    tenantId: 'tenant-1',
    baseUrl: 'https://evo.teste',
    apiKeyEncrypted: 'cifrada',
    instance: 'inst-1',
    estado: 'CONECTADO',
    lastError: null,
    quedaDesde: null,
    quedaAvisadaEm: null,
    ...sessao,
  };
  const prisma = {
    client: {
      evolutionSettings: {
        findMany: jest.fn().mockResolvedValue([linha]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Padaria Sol' }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'dono',
            name: 'Ana Souza',
            email: 'ana@sol.com',
            role: 'OWNER',
          },
          { id: 'admin', name: 'Bia', email: 'bia@sol.com', role: 'ADMIN' },
        ]),
      },
    },
  };
  const email = { enviar: jest.fn().mockResolvedValue(true) };
  const push = { avisarPessoas: jest.fn().mockResolvedValue(undefined) };
  const realtime = { emitToTenant: jest.fn() };
  const vigia = new VigiaDoWhatsappService(
    prisma as never,
    { decrypt: () => 'chave' } as never,
    email as never,
    push as never,
    realtime as never,
  );
  return { vigia, prisma, email, push, realtime };
}

describe('vigia do WhatsApp', () => {
  let estado: jest.SpyInstance;

  beforeEach(() => {
    process.env.PLATFORM_ADMIN_EMAILS = 'renan@plataforma.com';
    estado = jest.spyOn(evolution, 'estado').mockResolvedValue({
      ok: true,
      dados: { instance: { state: 'open' } },
    });
  });

  afterEach(() => estado.mockRestore());

  it('caiu agora: só anota o começo da queda, não avisa ninguém', async () => {
    const { vigia, prisma, email } = vigiaCom({
      estado: 'DESCONECTADO',
      lastError: 'a sessão caiu no servidor de mensagens',
    });

    await vigia.vigiar(AGORA);

    expect(prisma.client.evolutionSettings.update).toHaveBeenCalledWith({
      where: { id: 'evo-1' },
      data: { quedaDesde: AGORA },
    });
    expect(email.enviar).not.toHaveBeenCalled();
  });

  it('caída há mais de 5 minutos: e-mail ao dono e push a dono e admin', async () => {
    const { vigia, email, push } = vigiaCom({
      estado: 'DESCONECTADO',
      lastError:
        'o aparelho foi desvinculado no WhatsApp; leia o QR code de novo',
      quedaDesde: minutosAtras(6),
    });

    await vigia.vigiar(AGORA);

    expect(email.enviar).toHaveBeenCalledTimes(1);
    expect(email.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        para: 'ana@sol.com',
        assunto: 'O WhatsApp da sua empresa desconectou',
      }),
    );
    expect(push.avisarPessoas).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ tag: 'whatsapp-caiu' }),
      ['dono', 'admin'],
    );
  });

  it('a mesma queda não é avisada duas vezes', async () => {
    const { vigia, email } = vigiaCom({
      estado: 'DESCONECTADO',
      lastError: 'a sessão caiu no servidor de mensagens',
      quedaDesde: minutosAtras(30),
      quedaAvisadaEm: minutosAtras(25),
    });

    await vigia.vigiar(AGORA);

    expect(email.enviar).not.toHaveBeenCalled();
  });

  it('desconectar pelo botão não é queda', async () => {
    // O botão zera `lastError`; só a queda de verdade grava um motivo.
    const { vigia, prisma, email } = vigiaCom({
      estado: 'DESCONECTADO',
      lastError: null,
    });

    await vigia.vigiar(AGORA);

    expect(prisma.client.evolutionSettings.update).not.toHaveBeenCalled();
    expect(email.enviar).not.toHaveBeenCalled();
  });

  it('voltou: a queda é esquecida, e a próxima volta a ser avisada', async () => {
    const { vigia, prisma } = vigiaCom({
      estado: 'CONECTADO',
      quedaDesde: minutosAtras(30),
      quedaAvisadaEm: minutosAtras(25),
    });

    await vigia.vigiar(AGORA);

    expect(prisma.client.evolutionSettings.update).toHaveBeenCalledWith({
      where: { id: 'evo-1' },
      data: { quedaDesde: null, quedaAvisadaEm: null },
    });
  });

  it('constava conectada mas o servidor diz que caiu: corrige a tela', async () => {
    // O aviso do webhook pode se perder; sem a pergunta direta a sessão
    // ficava "conectada" pra sempre.
    estado.mockResolvedValue({
      ok: true,
      dados: { instance: { state: 'close' } },
    });
    const { vigia, prisma, realtime } = vigiaCom({ estado: 'CONECTADO' });

    await vigia.vigiar(AGORA);

    expect(prisma.client.evolutionSettings.update).toHaveBeenCalledWith({
      where: { id: 'evo-1' },
      data: expect.objectContaining({ estado: 'DESCONECTADO' }) as object,
    });
    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'canal.estado',
      expect.objectContaining({ estado: 'DESCONECTADO' }),
    );
  });

  it('servidor fora do ar: avisa a plataforma, não a empresa', async () => {
    estado.mockResolvedValue({ ok: false, erro: 'fetch failed' });
    const { vigia, email, push } = vigiaCom({ estado: 'CONECTADO' });

    await vigia.vigiar(AGORA);
    expect(email.enviar).not.toHaveBeenCalled();

    await vigia.vigiar(new Date(AGORA.getTime() + TOLERANCIA_MS + 1000));
    expect(email.enviar).toHaveBeenCalledTimes(1);
    expect(email.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ para: 'renan@plataforma.com' }),
    );
    expect(push.avisarPessoas).not.toHaveBeenCalled();

    // Uma vez por queda do servidor.
    await vigia.vigiar(new Date(AGORA.getTime() + 2 * TOLERANCIA_MS));
    expect(email.enviar).toHaveBeenCalledTimes(1);
  });
});
