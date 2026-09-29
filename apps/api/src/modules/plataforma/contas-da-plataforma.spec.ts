import { BadRequestException, ConflictException } from '@nestjs/common';
import { clienteStripe } from '../billing/stripe-cliente';
import { ContasDaPlataforma } from './contas-da-plataforma.service';

jest.mock('../billing/stripe-cliente', () => ({ clienteStripe: jest.fn() }));

const DIA = 24 * 3600 * 1000;

function montar({
  billing = null as null | {
    id?: string;
    stripeSubscriptionId?: string | null;
    liberadoAte?: Date | null;
  },
  donos = 0,
} = {}) {
  const upsert = jest.fn().mockResolvedValue({});
  const update = jest.fn().mockResolvedValue({});
  const prisma = {
    client: {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 't1',
          name: 'Padaria Boa',
          billing: billing
            ? {
                id: 'b1',
                stripeSubscriptionId: null,
                liberadoAte: null,
                ...billing,
              }
            : null,
        }),
      },
      billingAccount: { upsert, update },
      user: { count: jest.fn().mockResolvedValue(donos) },
    },
  };
  const eventos = { registrar: jest.fn().mockResolvedValue(undefined) };
  const servico = new ContasDaPlataforma(
    prisma as never,
    eventos as never,
    {} as never,
    {} as never,
  );
  const apagar = jest.fn().mockResolvedValue({ ok: true });
  const emAndamento = jest.fn().mockReturnValue(false);
  Object.assign((servico as unknown as { apagador: object }).apagador, {
    apagar,
    emAndamento,
  });
  return { servico, upsert, update, eventos, apagar };
}

function stripeFalso(assinatura: object) {
  const stripe = {
    subscriptions: {
      retrieve: jest.fn().mockResolvedValue(assinatura),
      update: jest.fn().mockResolvedValue({}),
      cancel: jest.fn().mockResolvedValue({ status: 'canceled' }),
    },
  };
  (clienteStripe as jest.Mock).mockReturnValue(stripe);
  return stripe;
}

describe('liberar dias pelo painel da plataforma', () => {
  beforeEach(() => jest.clearAllMocks());

  it('conta sem assinatura: só grava o acesso, não toca no Stripe', async () => {
    const { servico, upsert } = montar();
    const antes = Date.now();
    const r = await servico.liberar('t1', { dias: 7 }, 'dono@x.com');

    expect(clienteStripe).not.toHaveBeenCalled();
    expect(r.cobrancaAdiadaPara).toBeNull();
    expect(r.aviso).toBeNull();
    expect(r.liberadoAte.getTime()).toBeGreaterThanOrEqual(antes + 7 * DIA);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { liberadoAte: r.liberadoAte, liberadoNota: null },
      }),
    );
  });

  it('com assinatura mas sem pedir adiamento: o Stripe segue cobrando normal', async () => {
    const { servico } = montar({ billing: { stripeSubscriptionId: 'sub_1' } });
    await servico.liberar('t1', { dias: 5 }, 'dono@x.com');
    expect(clienteStripe).not.toHaveBeenCalled();
  });

  it('adiar cobrança parte do fim do período já pago — nada de dia pago perdido', async () => {
    const fimDoPeriodo = Math.floor((Date.now() + 10 * DIA) / 1000);
    const stripe = stripeFalso({
      status: 'active',
      trial_end: null,
      items: { data: [{ current_period_end: fimDoPeriodo }] },
    });
    const { servico } = montar({ billing: { stripeSubscriptionId: 'sub_1' } });

    const r = await servico.liberar(
      't1',
      { dias: 15, adiarCobranca: true },
      'dono@x.com',
    );

    const esperado = fimDoPeriodo + 15 * 24 * 3600;
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
      trial_end: esperado,
      proration_behavior: 'none',
    });
    expect(r.cobrancaAdiadaPara?.getTime()).toBe(esperado * 1000);
    // O acesso vai ao menos até a nova cobrança.
    expect(r.liberadoAte.getTime()).toBeGreaterThanOrEqual(esperado * 1000);
    expect(r.aviso).toBeNull();
  });

  it('assinatura com pagamento pendente: libera o acesso e não mexe na cobrança', async () => {
    const stripe = stripeFalso({
      status: 'past_due',
      trial_end: null,
      items: { data: [] },
    });
    const { servico, upsert } = montar({
      billing: { stripeSubscriptionId: 'sub_1' },
    });

    const r = await servico.liberar(
      't1',
      { dias: 3, adiarCobranca: true },
      'dono@x.com',
    );

    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(r.aviso).toMatch(/past_due/);
    expect(upsert).toHaveBeenCalled();
  });

  it('o Stripe falhando não impede o acesso — só volta um aviso', async () => {
    const stripe = stripeFalso({});
    stripe.subscriptions.retrieve.mockRejectedValue(new Error('rede caiu'));
    const { servico, upsert } = montar({
      billing: { stripeSubscriptionId: 'sub_1' },
    });

    const r = await servico.liberar(
      't1',
      { dias: 3, adiarCobranca: true },
      'dono@x.com',
    );

    expect(upsert).toHaveBeenCalled();
    expect(r.cobrancaAdiadaPara).toBeNull();
    expect(r.aviso).toMatch(/rede caiu/);
  });

  it('dias somam ao que ainda falta da liberação anterior', async () => {
    const ate = new Date(Date.now() + 4 * DIA);
    const { servico } = montar({ billing: { liberadoAte: ate } });
    const r = await servico.liberar('t1', { dias: 10 }, 'dono@x.com');
    expect(r.liberadoAte.getTime()).toBe(ate.getTime() + 10 * DIA);
  });

  it('recusa quantidade fora do limite', async () => {
    const { servico } = montar();
    await expect(
      servico.liberar('t1', { dias: 0 }, 'dono@x.com'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      servico.liberar('t1', { dias: 400 }, 'dono@x.com'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('apagar conta pelo painel da plataforma', () => {
  const antes = process.env.PLATFORM_ADMIN_EMAILS;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PLATFORM_ADMIN_EMAILS = 'dono@x.com';
  });
  afterAll(() => {
    process.env.PLATFORM_ADMIN_EMAILS = antes;
  });

  it('exige o nome da empresa digitado', async () => {
    const { servico, apagar } = montar();
    await expect(
      servico.apagar('t1', 'Outra', 'dono@x.com'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(apagar).not.toHaveBeenCalled();
  });

  it('não apaga a conta de um dono da plataforma', async () => {
    const { servico, apagar } = montar({ donos: 1 });
    await expect(
      servico.apagar('t1', 'padaria boa', 'dono@x.com'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(apagar).not.toHaveBeenCalled();
  });

  it('cancela o Stripe antes de apagar', async () => {
    const stripe = stripeFalso({});
    const { servico, apagar, update } = montar({
      billing: { stripeSubscriptionId: 'sub_1' },
    });

    await servico.apagar('t1', 'Padaria Boa', 'dono@x.com');

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_1', {
      prorate: false,
      invoice_now: false,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stripeSubscriptionId: null, planLabel: 'Cancelada' },
      }),
    );
    expect(apagar).toHaveBeenCalled();
  });

  it('Stripe falhou: a conta NÃO é apagada', async () => {
    const stripe = stripeFalso({});
    stripe.subscriptions.cancel.mockRejectedValue(new Error('timeout'));
    const { servico, apagar } = montar({
      billing: { stripeSubscriptionId: 'sub_1' },
    });

    await expect(
      servico.apagar('t1', 'Padaria Boa', 'dono@x.com'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(apagar).not.toHaveBeenCalled();
  });

  it('assinatura que o Stripe já não conhece não trava o apagamento', async () => {
    const stripe = stripeFalso({});
    stripe.subscriptions.cancel.mockRejectedValue(
      new Error('No such subscription: sub_1'),
    );
    const { servico, apagar } = montar({
      billing: { stripeSubscriptionId: 'sub_1' },
    });

    await servico.apagar('t1', 'Padaria Boa', 'dono@x.com');
    expect(apagar).toHaveBeenCalled();
  });
});
