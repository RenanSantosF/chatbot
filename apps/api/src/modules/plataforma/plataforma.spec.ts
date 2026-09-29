import { ForbiddenException } from '@nestjs/common';
import { PlataformaGuard, ehDaPlataforma } from './plataforma.guard';
import { situacaoDaCobranca } from './plataforma.service';
import { RegistroDeErros, normalizar } from './registro-de-erros.service';
import { RegistroDeEventos } from './registro-de-eventos.service';

describe('quem é dono da plataforma', () => {
  const antes = process.env.PLATFORM_ADMIN_EMAILS;
  afterEach(() => {
    process.env.PLATFORM_ADMIN_EMAILS = antes;
  });

  it('vem da variável de ambiente, sem diferença de maiúsculas', () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'Dono@Empresa.com, outro@x.com';
    expect(ehDaPlataforma('dono@empresa.com')).toBe(true);
    expect(ehDaPlataforma('outro@x.com')).toBe(true);
    expect(ehDaPlataforma('cliente@x.com')).toBe(false);
  });

  it('sem a variável, ninguém é', () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(ehDaPlataforma('dono@empresa.com')).toBe(false);
  });

  it('o guard recusa quem não está na lista', () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'dono@empresa.com';
    const contexto = (email: string) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user: { email } }) }),
      }) as never;
    const guard = new PlataformaGuard();
    expect(guard.canActivate(contexto('dono@empresa.com'))).toBe(true);
    expect(() => guard.canActivate(contexto('cliente@x.com'))).toThrow(
      ForbiddenException,
    );
  });
});

describe('situação da cobrança de cada conta', () => {
  const agora = new Date('2026-09-29T12:00:00Z').getTime();
  const conta = (mudanca: object) => ({
    stripeSubscriptionId: null,
    planLabel: 'Grátis',
    assinaturaVencidaEm: null,
    ...mudanca,
  });

  it('com assinatura é pagante', () => {
    expect(
      situacaoDaCobranca(conta({ stripeSubscriptionId: 'sub_1' }), agora),
    ).toBe('pagante');
  });

  it('venceu há menos de 2 dias: carência; mais: pendente ou cancelada', () => {
    const ontem = new Date(agora - 24 * 3600 * 1000);
    const semana = new Date(agora - 7 * 24 * 3600 * 1000);
    expect(
      situacaoDaCobranca(conta({ assinaturaVencidaEm: ontem }), agora),
    ).toBe('carencia');
    expect(
      situacaoDaCobranca(
        conta({ assinaturaVencidaEm: semana, planLabel: 'Pagamento pendente' }),
        agora,
      ),
    ).toBe('pendente');
    expect(
      situacaoDaCobranca(
        conta({ assinaturaVencidaEm: semana, planLabel: 'Cancelada' }),
        agora,
      ),
    ).toBe('cancelada');
  });

  it('nunca assinou', () => {
    expect(situacaoDaCobranca(conta({}), agora)).toBe('sem_assinatura');
    expect(situacaoDaCobranca(null, agora)).toBe('sem_assinatura');
  });
});

describe('registro de erros', () => {
  it('o mesmo erro com ids diferentes vira uma linha só', () => {
    expect(
      normalizar(
        'Conversa 3f2a1b4c-1111-2222-3333-444455556666 não encontrada',
      ),
    ).toBe(
      normalizar(
        'Conversa 91bc0d2e-aaaa-bbbb-cccc-ddddeeeeffff não encontrada',
      ),
    );
    expect(normalizar('falhou pra ana@x.com na linha 42')).toBe(
      'falhou pra @ na linha #',
    );
  });

  it('soma a ocorrência e reabre o que estava resolvido', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const registro = new RegistroDeErros({
      client: { erroDaPlataforma: { upsert } },
    } as never);

    await registro.registrar({
      origem: 'api',
      mensagem: 'boom',
      rota: 'GET /x/123',
    });

    const args = (
      upsert.mock.calls[0] as [
        {
          update: { ocorrencias: unknown; resolvido: boolean };
          create: { rota: string };
        },
      ]
    )[0];
    expect(args.update.ocorrencias).toEqual({ increment: 1 });
    expect(args.update.resolvido).toBe(false);
    expect(args.create.rota).toBe('GET /x/#');
  });

  it('nunca lança — é chamado de dentro do tratamento de erro', async () => {
    const registro = new RegistroDeErros({
      client: {
        erroDaPlataforma: {
          upsert: jest.fn().mockRejectedValue(new Error('banco fora')),
        },
      },
    } as never);
    await expect(
      registro.registrar({ origem: 'web', mensagem: 'x' }),
    ).resolves.toBeUndefined();
  });
});

describe('registro de eventos', () => {
  it('a chave deixa o banco descartar o repetido', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const eventos = new RegistroDeEventos({
      client: { eventoDaPlataforma: { createMany } },
    } as never);

    await eventos.registrar('painel_acesso', {
      userId: 'u1',
      chave: 'acesso:u1:2026-09-29',
    });

    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [
          expect.objectContaining({
            chave: 'acesso:u1:2026-09-29',
            tipo: 'painel_acesso',
          }),
        ],
      }),
    );
  });

  it('falhar não derruba quem registrou (cadastro, webhook)', async () => {
    const eventos = new RegistroDeEventos({
      client: {
        eventoDaPlataforma: {
          createMany: jest.fn().mockRejectedValue(new Error('x')),
        },
      },
    } as never);
    await expect(eventos.registrar('conta_criada')).resolves.toBeUndefined();
  });
});
