import { intervaloDoPeriodo } from './copilot-leitura.service';
import {
  RelatorioSemanalService,
  horaDoRelatorio,
} from './relatorio-semanal.service';

const SP = 'America/Sao_Paulo';

describe('quando o resumo da semana sai', () => {
  // 2026-10-05 é uma segunda-feira.
  it('segunda antes das 8h de São Paulo ainda não', () => {
    expect(horaDoRelatorio(SP, null, new Date('2026-10-05T10:59:00Z'))).toBe(
      false,
    );
  });

  it('segunda a partir das 8h, sim', () => {
    expect(horaDoRelatorio(SP, null, new Date('2026-10-05T11:00:00Z'))).toBe(
      true,
    );
  });

  it('uma vez por semana', () => {
    const enviadoSegunda = new Date('2026-10-05T11:05:00Z');
    expect(
      horaDoRelatorio(SP, enviadoSegunda, new Date('2026-10-07T15:00:00Z')),
    ).toBe(false);
    // Na segunda seguinte, de novo.
    expect(
      horaDoRelatorio(SP, enviadoSegunda, new Date('2026-10-12T11:30:00Z')),
    ).toBe(true);
  });

  it('a segunda passou com o servidor fora: sai atrasado, na terça', () => {
    const semanaRetrasada = new Date('2026-09-28T11:05:00Z');
    expect(
      horaDoRelatorio(SP, semanaRetrasada, new Date('2026-10-06T13:00:00Z')),
    ).toBe(true);
  });
});

describe('a semana passada', () => {
  it('vai de segunda a domingo, no fuso da empresa', () => {
    const { de, ate } = intervaloDoPeriodo(
      'semanaPassada',
      SP,
      new Date('2026-10-05T12:00:00Z'),
    );
    expect(de.toISOString()).toBe('2026-09-28T03:00:00.000Z');
    expect(ate.toISOString()).toBe('2026-10-05T02:59:59.999Z');
  });

  it('no domingo ainda é a semana que terminou no domingo anterior', () => {
    const { de } = intervaloDoPeriodo(
      'semanaPassada',
      SP,
      new Date('2026-10-04T15:00:00Z'),
    );
    expect(de.toISOString()).toBe('2026-09-21T03:00:00.000Z');
  });
});

describe('o envio', () => {
  function montar(clientes: number) {
    const prisma = {
      client: {
        tenant: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'tenant-1',
              name: 'Padaria Sol',
              timezone: SP,
              relatorioSemanalEm: null,
            },
          ]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        user: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ name: 'Ana Souza', email: 'ana@sol.com' }]),
        },
      },
    };
    const email = {
      configurado: true,
      enviar: jest.fn().mockResolvedValue(true),
    };
    const leitura = {
      relatorio: jest.fn().mockResolvedValue({
        clientesQueEscreveram: clientes,
        ia: {
          atendeuSozinha: 30,
          porcentoDosClientes: 75,
          passouParaAEquipe: 10,
          tempoMedioDeResposta: '8 s',
        },
        equipe: { tempoMedioDeResposta: '12 min' },
        horariosDePico: [{ faixa: '10h–11h' }],
        diaMaisMovimentado: 'segunda',
        aindaSemResposta: 2,
      }),
      perguntasQueAIaNaoSoube: jest.fn().mockResolvedValue({
        itens: [{ cliente: 'João', perguntaDoCliente: 'Vocês entregam?' }],
      }),
    };
    const moduleRef = {
      registerRequestByContextId: jest.fn(),
      resolve: jest.fn().mockResolvedValue(leitura),
    };
    const service = new RelatorioSemanalService(
      prisma as never,
      email as never,
      moduleRef as never,
    );
    return { service, prisma, email, moduleRef, leitura };
  }

  it('manda ao dono os números da semana, lidos como a empresa', async () => {
    const { service, email, moduleRef, leitura } = montar(40);

    await service.enviarOsDevidos(new Date('2026-10-05T11:30:00Z'));

    expect(moduleRef.registerRequestByContextId).toHaveBeenCalledWith(
      { user: { tenantId: 'tenant-1' } },
      expect.anything(),
    );
    expect(leitura.relatorio).toHaveBeenCalledWith({
      periodo: 'semanaPassada',
    });
    const [[enviado]] = email.enviar.mock.calls as [
      [{ para: string; assunto: string; texto: string }],
    ];
    expect(enviado.para).toBe('ana@sol.com');
    expect(enviado.assunto).toContain('40 clientes');
    expect(enviado.texto).toContain('Atendidos só pela IA: 30 (75%)');
    expect(enviado.texto).toContain('Vocês entregam?');
  });

  it('semana sem nenhum cliente não vira e-mail', async () => {
    const { service, email, prisma } = montar(0);

    await service.enviarOsDevidos(new Date('2026-10-05T11:30:00Z'));

    expect(email.enviar).not.toHaveBeenCalled();
    // Mas conta como a desta semana: não fica tentando a cada 15 minutos.
    expect(prisma.client.tenant.updateMany).toHaveBeenCalled();
  });

  it('sem e-mail configurado não faz nada (e não marca como enviado)', async () => {
    const { service, email, prisma } = montar(40);
    email.configurado = false;

    await service.enviarOsDevidos(new Date('2026-10-05T11:30:00Z'));

    expect(prisma.client.tenant.updateMany).not.toHaveBeenCalled();
  });
});
