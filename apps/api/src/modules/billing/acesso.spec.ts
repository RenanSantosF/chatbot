import { decidirAcesso, novaLiberacao, proximaCobrancaAdiada } from './acesso';

const DIA = 24 * 60 * 60 * 1000;
const agora = new Date('2026-09-30T12:00:00Z').getTime();
const conta = (mudanca: object = {}) => ({
  stripeSubscriptionId: null,
  assinaturaVencidaEm: null,
  liberadoAte: null,
  ...mudanca,
});

describe('decidirAcesso — quem vence quem', () => {
  it('dono da plataforma: liberado mesmo sem nada', () => {
    const d = decidirAcesso(conta(), { daPlataforma: true, agora });
    expect(d).toEqual(
      expect.objectContaining({ bloqueado: false, motivo: 'plataforma' }),
    );
  });

  it('liberação manual valendo: liberado mesmo sem assinatura (teste)', () => {
    const d = decidirAcesso(conta({ liberadoAte: new Date(agora + 5 * DIA) }), {
      agora,
    });
    expect(d).toEqual(
      expect.objectContaining({ bloqueado: false, motivo: 'liberado' }),
    );
  });

  it('liberação manual vence o pagamento atrasado do Stripe', () => {
    const d = decidirAcesso(
      conta({
        assinaturaVencidaEm: new Date(agora - 10 * DIA),
        liberadoAte: new Date(agora + DIA),
      }),
      { agora },
    );
    expect(d.bloqueado).toBe(false);
    expect(d.motivo).toBe('liberado');
  });

  it('liberação de teste acabou e nunca assinou: bloqueia, sem carência', () => {
    const d = decidirAcesso(conta({ liberadoAte: new Date(agora - 1000) }), {
      agora,
    });
    expect(d).toEqual(
      expect.objectContaining({
        bloqueado: true,
        emCarencia: false,
        motivo: 'bloqueado',
      }),
    );
  });

  it('assinatura em dia segue liberada depois que a liberação acaba', () => {
    const d = decidirAcesso(
      conta({
        stripeSubscriptionId: 'sub_1',
        liberadoAte: new Date(agora - DIA),
      }),
      { agora },
    );
    expect(d.motivo).toBe('assinatura');
  });

  it('atraso antigo: a carência conta do FIM da liberação, não do atraso', () => {
    const fimDaLiberacao = agora - 60 * 60 * 1000; // acabou há 1h
    const d = decidirAcesso(
      conta({
        assinaturaVencidaEm: new Date(agora - 30 * DIA),
        liberadoAte: new Date(fimDaLiberacao),
      }),
      { agora },
    );
    expect(d.emCarencia).toBe(true);
    expect(d.bloqueiaEm).toBe(fimDaLiberacao + 2 * DIA);
  });
});

describe('novaLiberacao', () => {
  it('soma ao que ainda falta', () => {
    const faltam3 = new Date(agora + 3 * DIA);
    expect(novaLiberacao(faltam3, 7, agora).getTime()).toBe(agora + 10 * DIA);
  });

  it('liberação vencida (ou nenhuma) conta a partir de agora', () => {
    expect(novaLiberacao(new Date(agora - 20 * DIA), 7, agora).getTime()).toBe(
      agora + 7 * DIA,
    );
    expect(novaLiberacao(null, 7, agora).getTime()).toBe(agora + 7 * DIA);
  });
});

describe('proximaCobrancaAdiada', () => {
  it('parte do fim do período já pago, e não de hoje', () => {
    const fimDoPeriodo = Math.floor((agora + 20 * DIA) / 1000);
    const nova = proximaCobrancaAdiada(
      { trialEnd: null, fimDoPeriodo },
      5,
      agora,
    );
    expect(nova.getTime()).toBe(fimDoPeriodo * 1000 + 5 * DIA);
  });

  it('um segundo adiamento soma ao primeiro', () => {
    const trialEnd = Math.floor((agora + 40 * DIA) / 1000);
    const fimDoPeriodo = Math.floor((agora + 20 * DIA) / 1000);
    const nova = proximaCobrancaAdiada({ trialEnd, fimDoPeriodo }, 5, agora);
    expect(nova.getTime()).toBe(trialEnd * 1000 + 5 * DIA);
  });
});
