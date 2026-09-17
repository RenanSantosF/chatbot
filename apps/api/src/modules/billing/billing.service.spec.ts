import { BadRequestException } from '@nestjs/common';
import { BillingService } from './billing.service';

/**
 * O Stripe de mentira.
 *
 * `jest.mock` no nível do módulo porque o serviço instancia o cliente
 * (`new Stripe(chave)`) por dentro, sob demanda — não é injetado, do
 * mesmo jeito que o `GoogleGenAI` do provedor de IA não é. Mockar o
 * módulo inteiro é o que permite controlar o que aquele `new` devolve.
 */
const sessionsCreate = jest.fn<
  Promise<{ url: string }>,
  [Record<string, unknown>]
>();
const portalCreate = jest.fn<
  Promise<{ url: string }>,
  [Record<string, unknown>]
>();
const constructEvent = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: sessionsCreate } },
    billingPortal: { sessions: { create: portalCreate } },
    webhooks: { constructEvent },
  }));
});

function montar(conta: Record<string, unknown> | null) {
  const criada = { id: 'billing-1', tenantId: 'tenant-1', ...conta };

  const prisma = {
    tenantId: 'tenant-1',
    db: {
      billingAccount: {
        findFirst: jest.fn().mockResolvedValue(conta),
        create: jest.fn().mockResolvedValue(criada),
      },
    },
  };

  const global = {
    client: {
      user: {
        findFirst: jest.fn().mockResolvedValue({ email: 'dona@empresa.com' }),
      },
      billingAccount: {
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    },
  };

  return {
    service: new BillingService(prisma as never, global as never),
    prisma,
    global,
  };
}

describe('BillingService.criarCheckout', () => {
  const antes = { ...process.env };
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_ID = 'price_123';
    process.env.WEB_APP_URL = 'https://app.exemplo.com';
    sessionsCreate.mockReset();
    portalCreate.mockReset();
    constructEvent.mockReset();
  });
  afterEach(() => {
    process.env = { ...antes };
  });

  it('abre uma sessão de assinatura vinculada ao tenant', async () => {
    sessionsCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/sessao-1',
    });
    const { service } = montar(null);

    const resultado = await service.criarCheckout();

    expect(resultado.url).toBe('https://checkout.stripe.com/sessao-1');
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        client_reference_id: 'tenant-1',
        customer_email: 'dona@empresa.com',
      }),
    );
  });

  it('reusa o cliente Stripe já existente em vez de pedir e-mail de novo', async () => {
    sessionsCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/sessao-2',
    });
    const { service } = montar({ stripeCustomerId: 'cus_existente' });

    await service.criarCheckout();

    const chamada = sessionsCreate.mock.calls[0][0];
    expect(chamada.customer).toBe('cus_existente');
    expect(chamada.customer_email).toBeUndefined();
  });

  it('recusa sem preço configurado', async () => {
    delete process.env.STRIPE_PRICE_ID;
    const { service } = montar(null);

    await expect(service.criarCheckout()).rejects.toThrow(BadRequestException);
  });

  it('recusa sem chave da plataforma configurada', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { service } = montar(null);

    await expect(service.criarCheckout()).rejects.toThrow(BadRequestException);
  });
});

describe('BillingService.criarPortal', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.WEB_APP_URL = 'https://app.exemplo.com';
    portalCreate.mockReset();
  });

  it('abre o portal pra quem já é cliente', async () => {
    portalCreate.mockResolvedValue({
      url: 'https://billing.stripe.com/portal-1',
    });
    const { service } = montar({ stripeCustomerId: 'cus_existente' });

    const resultado = await service.criarPortal();

    expect(resultado.url).toBe('https://billing.stripe.com/portal-1');
  });

  it('recusa pra quem nunca assinou', async () => {
    const { service } = montar(null);

    await expect(service.criarPortal()).rejects.toThrow(BadRequestException);
  });
});

describe('BillingService.criarCheckoutExtra', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_TOPUP_PRICE_ID = 'price_topup_123';
    process.env.WEB_APP_URL = 'https://app.exemplo.com';
    sessionsCreate.mockReset();
  });

  it('abre um checkout de pagamento único pra quem já é cliente', async () => {
    sessionsCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/extra-1',
    });
    const { service } = montar({ stripeCustomerId: 'cus_existente' });

    const resultado = await service.criarCheckoutExtra();

    expect(resultado.url).toBe('https://checkout.stripe.com/extra-1');
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'payment', customer: 'cus_existente' }),
    );
  });

  it('recusa pra quem nunca assinou — pacote extra não é porta de entrada', async () => {
    const { service } = montar(null);

    await expect(service.criarCheckoutExtra()).rejects.toThrow(
      BadRequestException,
    );
  });

  it('recusa sem o preço do pacote configurado', async () => {
    delete process.env.STRIPE_TOPUP_PRICE_ID;
    const { service } = montar({ stripeCustomerId: 'cus_existente' });

    await expect(service.criarCheckoutExtra()).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('BillingService.statusDeAcesso', () => {
  const { service } = montar(null);

  it('libera quem tem assinatura ativa', () => {
    const resultado = service.statusDeAcesso({
      stripeSubscriptionId: 'sub_1',
      assinaturaVencidaEm: null,
    });
    expect(resultado).toEqual({
      bloqueado: false,
      emCarencia: false,
      vencidoDesde: null,
      bloqueiaEm: null,
    });
  });

  it('bloqueia direto, sem carência, quem nunca assinou', () => {
    const resultado = service.statusDeAcesso({
      stripeSubscriptionId: null,
      assinaturaVencidaEm: null,
    });
    expect(resultado).toEqual({
      bloqueado: true,
      emCarencia: false,
      vencidoDesde: null,
      bloqueiaEm: null,
    });
  });

  it('dá carência a quem já assinava e ficou em atraso há poucas horas', () => {
    const vencidoDesde = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h atrás
    const resultado = service.statusDeAcesso({
      stripeSubscriptionId: null,
      assinaturaVencidaEm: vencidoDesde,
    });
    expect(resultado.bloqueado).toBe(false);
    expect(resultado.emCarencia).toBe(true);
    expect(resultado.bloqueiaEm).toBe(
      vencidoDesde.getTime() + 2 * 24 * 60 * 60 * 1000,
    );
  });

  it('bloqueia quem já assinava e passou dos 2 dias de carência', () => {
    const vencidoDesde = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 dias atrás
    const resultado = service.statusDeAcesso({
      stripeSubscriptionId: null,
      assinaturaVencidaEm: vencidoDesde,
    });
    expect(resultado.bloqueado).toBe(true);
    expect(resultado.emCarencia).toBe(false);
  });
});

describe('BillingService.processarEvento', () => {
  it('grava cliente e assinatura na primeira vez que o checkout completa', async () => {
    const { service, global } = montar(null);

    await service.processarEvento({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'tenant-1',
          customer: 'cus_novo',
          subscription: 'sub_novo',
        },
      },
    } as never);

    expect(global.client.billingAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1' },
        create: expect.objectContaining({
          stripeCustomerId: 'cus_novo',
          stripeSubscriptionId: 'sub_novo',
          planLabel: 'Assinatura ativa',
        }),
      }),
    );
  });

  it('ignora o checkout sem client_reference_id, em vez de estourar', async () => {
    const { service, global } = montar(null);

    await service.processarEvento({
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: null, customer: 'cus_novo' } },
    } as never);

    expect(global.client.billingAccount.upsert).not.toHaveBeenCalled();
  });

  it('marca a conta em dia e limpa a carência quando a assinatura muda pra "active"', async () => {
    const { service, global } = montar(null);
    global.client.billingAccount.findFirst.mockResolvedValue({
      id: 'billing-1',
      tenantId: 'tenant-1',
      assinaturaVencidaEm: new Date('2026-01-01'),
    });

    await service.processarEvento({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active' } },
    } as never);

    expect(global.client.billingAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          stripeSubscriptionId: 'sub_1',
          planLabel: 'Assinatura ativa',
          assinaturaVencidaEm: null,
        },
      }),
    );
  });

  it('marca a conta como cancelada e começa a carência quando a assinatura é deletada', async () => {
    const { service, global } = montar(null);
    global.client.billingAccount.findFirst.mockResolvedValue({
      id: 'billing-1',
      tenantId: 'tenant-1',
      assinaturaVencidaEm: null,
    });

    await service.processarEvento({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } },
    } as never);

    expect(global.client.billingAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stripeSubscriptionId: null,
          planLabel: 'Cancelada',
          assinaturaVencidaEm: expect.any(Date),
        }),
      }),
    );
  });

  it('não reinicia o relógio da carência numa segunda tentativa de cobrança falhando', async () => {
    const { service, global } = montar(null);
    const primeiraFalha = new Date('2026-01-01T10:00:00Z');
    global.client.billingAccount.findFirst.mockResolvedValue({
      id: 'billing-1',
      tenantId: 'tenant-1',
      assinaturaVencidaEm: primeiraFalha,
    });

    await service.processarEvento({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'past_due' } },
    } as never);

    const dadosGravados =
      global.client.billingAccount.update.mock.calls[0][0].data;
    expect(dadosGravados).not.toHaveProperty('assinaturaVencidaEm');
    expect(dadosGravados.planLabel).toBe('Pagamento pendente');
  });

  it('credita o pacote avulso quando o checkout de pagamento único completa', async () => {
    const { service, global } = montar(null);

    await service.processarEvento({
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'payment',
          client_reference_id: 'tenant-1',
        },
      },
    } as never);

    expect(global.client.billingAccount.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      data: { aiExtraMessagesThisPeriod: { increment: 1000 } },
    });
    expect(global.client.billingAccount.upsert).not.toHaveBeenCalled();
  });

  it('não estoura quando o evento chega pra um cliente sem BillingAccount', async () => {
    const { service, global } = montar(null);
    global.client.billingAccount.findFirst.mockResolvedValue(null);

    await expect(
      service.processarEvento({
        type: 'customer.subscription.updated',
        data: {
          object: { id: 'sub_1', customer: 'cus_orfao', status: 'active' },
        },
      } as never),
    ).resolves.toBeUndefined();
    expect(global.client.billingAccount.update).not.toHaveBeenCalled();
  });

  it('ignora tipos de evento que não interessam a este sistema', async () => {
    const { service, global } = montar(null);

    await service.processarEvento({
      type: 'invoice.paid',
      data: { object: {} },
    } as never);

    expect(global.client.billingAccount.upsert).not.toHaveBeenCalled();
    expect(global.client.billingAccount.update).not.toHaveBeenCalled();
  });
});

describe('BillingService.verificarAssinatura', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    constructEvent.mockReset();
  });

  it('devolve o evento quando a assinatura bate', () => {
    const { service } = montar(null);
    const evento = { type: 'checkout.session.completed' };
    constructEvent.mockReturnValue(evento);

    expect(
      service.verificarAssinatura(Buffer.from('{}'), 'assinatura-valida'),
    ).toBe(evento);
  });

  it('recusa quando o Stripe rejeita a assinatura', () => {
    const { service } = montar(null);
    constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });

    expect(() =>
      service.verificarAssinatura(Buffer.from('{}'), 'forjada'),
    ).toThrow(BadRequestException);
  });

  it('recusa sem o segredo do webhook configurado', () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { service } = montar(null);

    expect(() =>
      service.verificarAssinatura(Buffer.from('{}'), 'qualquer'),
    ).toThrow(BadRequestException);
  });
});
