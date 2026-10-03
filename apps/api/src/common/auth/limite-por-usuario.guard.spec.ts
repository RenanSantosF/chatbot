import { JwtService } from '@nestjs/jwt';
import { LimitePorUsuarioGuard } from './limite-por-usuario.guard';

/**
 * Todas as empresas chegam à API pelo mesmo endereço (o do Next e da
 * borda do Railway). Contar por IP punha todo mundo num balde só.
 */
describe('limite de requisições por pessoa', () => {
  const SEGREDO = 'segredo-de-teste';
  const assinar = (sub: string, segredo = SEGREDO) =>
    new JwtService().sign({ sub }, { secret: segredo });
  const guard = new LimitePorUsuarioGuard(
    [] as never,
    {} as never,
    {} as never,
  );
  const rastrear = (req: Record<string, unknown>) =>
    (
      guard as unknown as {
        getTracker: (r: Record<string, unknown>) => Promise<string>;
      }
    ).getTracker(req);

  beforeEach(() => {
    process.env.JWT_SECRET = SEGREDO;
  });

  it('duas pessoas no mesmo IP têm baldes separados', async () => {
    const ana = await rastrear({
      ip: '10.0.0.1',
      cookies: { access_token: assinar('ana') },
    });
    const bruno = await rastrear({
      ip: '10.0.0.1',
      headers: { authorization: `Bearer ${assinar('bruno')}` },
    });

    expect(ana).toBe('usuario:ana');
    expect(bruno).toBe('usuario:bruno');
  });

  it('token forjado não escapa do limite: conta pelo IP', async () => {
    const tracker = await rastrear({
      ip: '10.0.0.1',
      cookies: { access_token: assinar('qualquer', 'outro-segredo') },
    });

    expect(tracker).toBe('10.0.0.1');
  });

  it('sem login e sem nada que identifique, conta pelo IP', async () => {
    expect(await rastrear({ ip: '10.0.0.2', headers: {} })).toBe('10.0.0.2');
  });

  it('entrar conta por e-mail: uma conta atacada não trava as outras', async () => {
    const ana = await rastrear({
      ip: '10.0.0.1',
      body: { email: ' Ana@Empresa.com ', password: 'x' },
    });
    const bruno = await rastrear({
      ip: '10.0.0.1',
      body: { email: 'bruno@empresa.com', password: 'x' },
    });

    expect(ana).toBe('10.0.0.1|email:ana@empresa.com');
    expect(bruno).not.toBe(ana);
  });

  it('o rastreio da landing conta por visitante', async () => {
    expect(
      await rastrear({ ip: '10.0.0.1', body: { visitante: 'v-123' } }),
    ).toBe('10.0.0.1|visitante:v-123');
  });
});
