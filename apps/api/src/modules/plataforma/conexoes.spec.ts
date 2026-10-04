import { PlataformaService } from './plataforma.service';

describe('saúde das conexões', () => {
  const agora = Date.now();
  const horasAtras = (h: number) => new Date(agora - h * 3600_000);

  function montar() {
    const client = {
      evolutionSettings: {
        findMany: jest.fn().mockResolvedValue([
          {
            tenantId: 'ok',
            estado: 'CONECTADO',
            lastSeenAt: horasAtras(1),
            lastError: null,
            quedaDesde: null,
            quedaAvisadaEm: null,
            tenant: { name: 'Padaria Sol', status: 'ACTIVE' },
          },
          {
            tenantId: 'caida',
            estado: 'DESCONECTADO',
            lastSeenAt: horasAtras(5),
            lastError: 'a sessão caiu no servidor de mensagens',
            quedaDesde: horasAtras(2),
            quedaAvisadaEm: horasAtras(1.9),
            tenant: { name: 'Clínica Lua', status: 'ACTIVE' },
          },
          {
            tenantId: 'nova',
            estado: 'AGUARDANDO_QRCODE',
            lastSeenAt: null,
            lastError: null,
            quedaDesde: null,
            quedaAvisadaEm: null,
            tenant: { name: 'Loja Nova', status: 'TRIAL' },
          },
        ]),
      },
      message: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            {
              tenantId: 'ok',
              _max: { createdAt: horasAtras(0.5) },
              _count: { _all: 40 },
            },
          ]),
      },
      eventoDaPlataforma: {
        findMany: jest.fn().mockResolvedValue([
          {
            tipo: 'whatsapp_caiu',
            tenantId: 'caida',
            dados: {},
            createdAt: horasAtras(2),
          },
          {
            tipo: 'mensagens_recuperadas',
            tenantId: 'ok',
            dados: { quantidade: 3 },
            createdAt: horasAtras(3),
          },
        ]),
      },
    };
    return new PlataformaService({ client } as never);
  }

  it('resume quem está de pé, caído e esperando o QR code', async () => {
    const { resumo, empresas } = await montar().conexoes();

    expect(resumo).toMatchObject({
      conectadas: 1,
      caidas: 1,
      nuncaConectaram: 1,
      quedasNaSemana: 1,
      recuperadasNaSemana: 3,
    });
    // A caída vem primeiro: é o que pede atenção.
    expect(empresas[0]).toMatchObject({
      nome: 'Clínica Lua',
      situacao: 'caida',
      quedasNaSemana: 1,
    });
    expect(empresas.find((e) => e.tenantId === 'ok')).toMatchObject({
      recebidasNaSemana: 40,
      recuperadasNaSemana: 3,
    });
  });
});
