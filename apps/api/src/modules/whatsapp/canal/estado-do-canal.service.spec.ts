import { EstadoDoCanalService } from './estado-do-canal.service';

/**
 * "Trazendo as conversas do aparelho" precisa ter fim.
 *
 * O aviso girou quase uma hora numa tela porque quem decidia era um
 * cronômetro no navegador: ele não sobrevive a recarregar a página, e numa
 * aba de celular em segundo plano o Chrome o congela — nunca dispara, e o
 * giro fica eterno.
 *
 * Aqui a decisão é do servidor e é recalculada a cada leitura, então ela
 * não depende de nenhuma aba estar viva nem acordada.
 */
function montar(evolution: Record<string, unknown> | null) {
  const prisma = {
    client: {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ canal: 'EVOLUTION' }),
      },
      evolutionSettings: { findFirst: jest.fn().mockResolvedValue(evolution) },
      whatsAppSettings: { findFirst: jest.fn().mockResolvedValue(null) },
    },
  };

  return new EstadoDoCanalService(prisma as never);
}

const conectado = (extra: Record<string, unknown>) => ({
  estado: 'CONECTADO',
  lastError: null,
  historicoMensagens: 0,
  ...extra,
});

describe('a importação do histórico tem fim', () => {
  it('está importando enquanto a janela não venceu', async () => {
    const service = montar(
      conectado({
        historicoEstado: 'IMPORTANDO',
        historicoIniciadoEm: new Date(Date.now() - 60_000),
      }),
    );

    const estado = await service.doTenant('tenant-1');

    expect(estado.historico.importando).toBe(true);
  });

  it('desiste depois de dez minutos, mesmo sem o aviso do aparelho', async () => {
    // O caso real: ninguém garante que o último lote chegue. Sem este
    // limite, "importando" não acaba nunca.
    const service = montar(
      conectado({
        historicoEstado: 'IMPORTANDO',
        historicoIniciadoEm: new Date(Date.now() - 11 * 60_000),
      }),
    );

    const estado = await service.doTenant('tenant-1');

    expect(estado.historico.importando).toBe(false);
  });

  it('para na hora quando o aparelho avisa que terminou', async () => {
    const service = montar(
      conectado({
        historicoEstado: 'CONCLUIDO',
        historicoIniciadoEm: new Date(),
        historicoMensagens: 412,
      }),
    );

    const estado = await service.doTenant('tenant-1');

    expect(estado.historico.importando).toBe(false);
    expect(estado.historico.mensagens).toBe(412);
  });

  it('quem nunca pareou não fica esperando conversa nenhuma', async () => {
    const service = montar(null);

    const estado = await service.doTenant('tenant-1');

    expect(estado.historico.importando).toBe(false);
    expect(estado.jaConectou).toBe(false);
  });

  it('sem hora de início não há o que esperar', async () => {
    // Estado gravado antes desta coluna existir. Sem esta guarda, a conta
    // de "quanto tempo faz" não teria de onde partir.
    const service = montar(
      conectado({ historicoEstado: 'IMPORTANDO', historicoIniciadoEm: null }),
    );

    const estado = await service.doTenant('tenant-1');

    expect(estado.historico.importando).toBe(false);
  });
});
