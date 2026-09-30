import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { CacheCurto } from '../../common/cache/cache-curto';
import { pacotesConfigurados, quantidadePaga } from './pacotes';
import { emailsDaPlataforma } from '../plataforma/plataforma.guard';
import { RegistroDeEventos } from '../plataforma/registro-de-eventos.service';
import {
  decidirAcesso,
  type ContaParaAcesso,
  type DecisaoDeAcesso,
  type MotivoDoAcesso,
} from './acesso';

/**
 * Se uma pessoa da empresa é dona da plataforma — um minuto de validade.
 *
 * `status()` roda em toda requisição (ver BillingGuard); sem isto seria
 * mais uma ida ao banco por clique pra uma resposta que só muda quando
 * alguém mexe na variável de ambiente (e aí o processo reinicia).
 */
const DA_PLATAFORMA = new CacheCurto<boolean>(60_000);

/**
 * O Checkout do Stripe só aceita adiar a primeira cobrança se ela cair a
 * pelo menos 48 horas de agora. Uma hora de folga por cima, pra o relógio
 * entre este servidor e o dele não recusar a sessão.
 */
const MINIMO_PRO_ADIAMENTO_NO_CHECKOUT_MS = 49 * 60 * 60 * 1000;

/** O Stripe respondeu que o cliente informado não existe (nesta conta/modo). */
export function clienteSumiu(erro: unknown): boolean {
  const e = erro as { code?: string; param?: string; message?: string } | null;
  return (
    (e?.code === 'resource_missing' && e.param === 'customer') ||
    /No such customer/i.test(e?.message ?? '')
  );
}

/**
 * Preço de cada pacote avulso, como o Stripe cobra (ver listarPacotes).
 *
 * Os pacotes em si vêm de `STRIPE_PACOTES` (ver pacotes.ts): mais de um
 * tamanho, com preço por resposta caindo nos maiores. A régua de preço
 * sugerida — e a conta de custo por trás dela — está no DEPLOY.md.
 */
const PRECOS = new CacheCurto<{
  centavos: number | null;
  moeda: string | null;
}>(10 * 60_000);

/**
 * O status de quando a consulta ao banco falhou (ver `status`): destrava
 * em vez de derrubar o painel de quem está em dia.
 */
const LIBERADO = {
  assinaturaAtiva: false,
  planLabel: 'Grátis',
  bloqueado: false,
  emCarencia: false,
  vencidoDesde: null,
  bloqueiaEm: null,
  liberadoAte: null,
  motivo: 'assinatura' as MotivoDoAcesso,
} as const;

/**
 * A assinatura da empresa, via Stripe.
 *
 * Uma conta Stripe só, da plataforma — a mesma que já funciona noutro
 * sistema (não é a empresa que cria conta em provedor nenhum, do mesmo
 * jeito que a chave de IA deixou de ser dela — ver AiCredentialsResolver).
 * O que sai daqui é sempre um link do Checkout ou do Portal do Stripe: a
 * cobrança de verdade, o cartão, o cancelamento, tudo acontece LÁ, nunca
 * neste código. O papel deste serviço é só abrir a porta certa e manter
 * `BillingAccount` sincronizada com o que o Stripe avisa por webhook.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private clienteStripe: Stripe | null = null;

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly global: PrismaService,
    // Opcional só pra os testes montarem o serviço sem ele.
    @Optional() private readonly eventos?: RegistroDeEventos,
  ) {}

  private stripe(): Stripe {
    if (this.clienteStripe) return this.clienteStripe;
    const chave = process.env.STRIPE_SECRET_KEY;
    if (!chave) {
      throw new BadRequestException(
        'Assinatura não está configurada nesta instalação. Fale com o suporte.',
      );
    }
    this.clienteStripe = new Stripe(chave);
    return this.clienteStripe;
  }

  /**
   * Pro Stripe voltar pra algum lugar depois do Checkout/Portal.
   *
   * `WEB_APP_URL` já existe — é a mesma variável que libera o CORS pro
   * front — então não cria configuração nova só pra isto.
   */
  private urlBase(): string {
    const bruto = process.env.WEB_APP_URL?.trim().replace(/\/+$/, '');
    return bruto || 'http://localhost:3000';
  }

  /**
   * A linha desta empresa, criada na primeira vez que alguém pede pra ver.
   *
   * Mesmo padrão de AiSettings/RetentionSettings: nasce sob demanda, não
   * no registro — assim uma conta antiga, de antes deste campo existir,
   * também funciona sem migração de dado.
   */
  private async contaAtual() {
    const existente = await this.prisma.db.billingAccount.findFirst();
    return (
      existente ??
      this.prisma.db.billingAccount.create({
        data: { tenantId: this.prisma.tenantId },
      })
    );
  }

  /**
   * Chamado em TODA requisição não-pública (ver BillingGuard) e em
   * `/auth/me` — um banco fora do ar ou uma migração incompleta aqui não
   * pode derrubar o painel inteiro. Quem já paga fica destrancado até a
   * causa ser corrigida; bloquear todo mundo igual, inclusive quem está em
   * dia, seria pior do que deixar passar por um instante.
   */
  async status() {
    // O interruptor que liberava TODAS as contas (BILLING_ENFORCEMENT=off)
    // não existe mais: quem fica liberado de graça agora é só a empresa
    // do dono da plataforma e quem ele liberou à mão (ver decidirAcesso).
    try {
      const [conta, daPlataforma] = await Promise.all([
        this.contaAtual(),
        this.ehDaPlataforma(this.prisma.tenantId),
      ]);
      return {
        assinaturaAtiva: Boolean(conta.stripeSubscriptionId),
        planLabel: conta.planLabel,
        ...decidirAcesso(conta, { daPlataforma }),
      };
    } catch (erro) {
      this.logger.error(
        'Não deu pra consultar o status da assinatura.',
        erro as Error,
      );
      return LIBERADO;
    }
  }

  /** Alguém desta empresa está em PLATFORM_ADMIN_EMAILS? */
  private async ehDaPlataforma(tenantId: string): Promise<boolean> {
    const lista = emailsDaPlataforma();
    if (lista.length === 0) return false;

    const chave = `${tenantId}|${lista.join(',')}`;
    const guardado = DA_PLATAFORMA.get(chave);
    if (guardado !== undefined) return guardado;

    const total = await this.global.client.user.count({
      where: { tenantId, email: { in: lista, mode: 'insensitive' } },
    });
    DA_PLATAFORMA.set(chave, total > 0);
    return total > 0;
  }

  /** Mantido pra quem já chamava por aqui; a régua mora em decidirAcesso. */
  statusDeAcesso(conta: ContaParaAcesso): DecisaoDeAcesso {
    return decidirAcesso(conta);
  }

  /**
   * Abre uma sessão de Checkout pra empresa assinar.
   *
   * Um plano só por enquanto (`STRIPE_PRICE_ID`) — quando existir mais de
   * um, o preço escolhido na tela vira parâmetro aqui, mas a mecânica de
   * abrir e sincronizar continua a mesma.
   *
   * O VALOR em si vive só no Stripe (o código não tem número nenhum
   * fixo), mas a recomendação registrada em DEPLOY.md é R$197/mês com
   * 3.000 respostas de IA incluídas — parity com o concorrente direto mais
   * próximo (chatbot de WhatsApp por QR code com IA, ~R$190-200/mês no
   * mercado brasileiro), e margem folgada sobre o custo real do provedor
   * (ver o comentário de `aiMonthlyMessageLimit` no schema e o de
   * AiUsageService).
   */
  async criarCheckout(): Promise<{ url: string }> {
    const precoId = process.env.STRIPE_PRICE_ID;
    if (!precoId) {
      throw new BadRequestException(
        'Nenhum plano de assinatura configurado nesta instalação. Fale com o suporte.',
      );
    }

    const conta = await this.contaAtual();
    const tenantId = this.prisma.tenantId;
    const base = this.urlBase();

    // E-mail só é enviado quando ainda NÃO existe cliente no Stripe: uma
    // vez criado, é o próprio Stripe quem sabe o e-mail de cobrança, e o
    // dono pode ter trocado o e-mail de login sem trocar o de pagamento.
    const emailDoDono = async () =>
      (
        await this.global.client.user.findFirst({
          where: { tenantId, role: 'OWNER' },
          select: { email: true },
        })
      )?.email ?? null;

    // Quem assina DURANTE uma liberação manual (teste, folga) não paga em
    // dobro: a primeira cobrança fica pro dia em que a liberação acaba.
    const primeiraCobranca =
      conta.liberadoAte &&
      conta.liberadoAte.getTime() - Date.now() >=
        MINIMO_PRO_ADIAMENTO_NO_CHECKOUT_MS
        ? Math.floor(conta.liberadoAte.getTime() / 1000)
        : null;

    const abrir = async (clienteId: string | null) => {
      const email = clienteId ? null : await emailDoDono();
      return this.stripe().checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: precoId, quantity: 1 }],
        ...(primeiraCobranca
          ? { subscription_data: { trial_end: primeiraCobranca } }
          : {}),
        // O campo "Adicionar código promocional" do Checkout: cupons
        // criados no Stripe (teste de ponta a ponta sem cobrança real,
        // campanhas de desconto) valem aqui sem mudar código.
        allow_promotion_codes: true,
        // É como o webhook liga o evento de volta a ESTA empresa (ver
        // processarEvento) — o Stripe não sabe nada sobre tenant.
        client_reference_id: tenantId,
        ...(clienteId
          ? { customer: clienteId }
          : email
            ? { customer_email: email }
            : {}),
        success_url: `${base}/dashboard/settings/account?assinatura=sucesso`,
        cancel_url: `${base}/dashboard/settings/account?assinatura=cancelada`,
      });
    };

    let sessao: Stripe.Checkout.Session;
    try {
      sessao = await abrir(conta.stripeCustomerId);
    } catch (erro) {
      // O cliente guardado não existe mais neste Stripe (veio do modo
      // teste, ou foi apagado no painel dele): esquece e abre como cliente
      // novo, em vez de deixar a empresa sem conseguir pagar.
      if (!conta.stripeCustomerId || !clienteSumiu(erro)) throw erro;
      await this.esquecerClienteDoStripe(conta.id, conta.stripeCustomerId);
      sessao = await abrir(null);
    }

    if (!sessao.url) {
      throw new BadRequestException(
        'Não deu pra criar a sessão de pagamento agora. Tente de novo.',
      );
    }
    // "Clicou em assinar" — o passo do funil entre criar a conta e pagar.
    await this.eventos?.registrar('checkout_iniciado', { tenantId });
    return { url: sessao.url };
  }

  /**
   * Abre uma sessão de Checkout pra comprar um pacote avulso de respostas
   * de IA, sem esperar o mês virar.
   *
   * Pagamento único (`mode: 'payment'`), não assinatura — é o que separa
   * este evento do outro no webhook (ver processarEvento). Só faz sentido
   * pra quem já é cliente, então usa o customer do Stripe já existente em
   * vez de pedir e-mail de novo.
   */
  async criarCheckoutExtra(quantidade?: number): Promise<{ url: string }> {
    const pacotes = pacotesConfigurados();
    if (pacotes.length === 0) {
      throw new BadRequestException(
        'Pacote de mensagens extras não está configurado nesta instalação. Fale com o suporte.',
      );
    }
    // Sem escolha, o menor — é o que o botão antigo (sem opções) comprava.
    const pacote = quantidade
      ? pacotes.find((p) => p.quantidade === quantidade)
      : pacotes[0];
    if (!pacote) {
      throw new BadRequestException('Esse pacote não está mais à venda.');
    }
    const precoId = pacote.precoId;

    const conta = await this.contaAtual();
    if (!conta.stripeCustomerId) {
      throw new BadRequestException(
        'Esta empresa ainda não tem assinatura — assine antes de comprar um pacote extra.',
      );
    }

    const base = this.urlBase();
    let sessao: Stripe.Checkout.Session;
    try {
      sessao = await this.stripe().checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: precoId, quantity: 1 }],
        allow_promotion_codes: true,
        // É o que o webhook lê pra saber quanto creditar (ver quantidadePaga).
        metadata: { pacote: String(pacote.quantidade) },
        client_reference_id: this.prisma.tenantId,
        customer: conta.stripeCustomerId,
        success_url: `${base}/dashboard/settings/ai?pacoteExtra=sucesso`,
        cancel_url: `${base}/dashboard/settings/ai?pacoteExtra=cancelado`,
      });
    } catch (erro) {
      if (!clienteSumiu(erro)) throw erro;
      await this.esquecerClienteDoStripe(conta.id, conta.stripeCustomerId);
      throw new BadRequestException(
        'Não encontramos a sua assinatura no Stripe. Assine de novo em Conta e depois compre o pacote.',
      );
    }

    if (!sessao.url) {
      throw new BadRequestException(
        'Não deu pra criar a sessão de pagamento agora. Tente de novo.',
      );
    }
    await this.eventos?.registrar('pacote_iniciado', {
      tenantId: this.prisma.tenantId,
    });
    return { url: sessao.url };
  }

  /**
   * Os pacotes à venda, com o preço que o Stripe cobra de verdade.
   *
   * O valor vem do próprio Stripe (e fica 10 minutos em memória), nunca
   * de um número escrito no código: mudou o preço lá, muda na tela. Se o
   * Stripe não responder, o pacote aparece sem preço — o Checkout mostra
   * o valor antes de cobrar de qualquer jeito.
   */
  async listarPacotes(): Promise<
    { quantidade: number; centavos: number | null; moeda: string | null }[]
  > {
    const pacotes = pacotesConfigurados();
    return Promise.all(
      pacotes.map(async ({ quantidade, precoId }) => {
        const guardado = PRECOS.get(precoId);
        if (guardado) return { quantidade, ...guardado };
        try {
          const preco = await this.stripe().prices.retrieve(precoId);
          const valor = {
            centavos: preco.unit_amount ?? null,
            moeda: preco.currency ?? null,
          };
          PRECOS.set(precoId, valor);
          return { quantidade, ...valor };
        } catch {
          return { quantidade, centavos: null, moeda: null };
        }
      }),
    );
  }

  /**
   * Abre o Portal do Stripe — trocar cartão, ver fatura, cancelar. Tudo
   * fora deste sistema, de propósito: é o Stripe quem sabe fazer isso com
   * segurança e conformidade, e reimplementar aqui seria retrabalho puro.
   */
  async criarPortal(): Promise<{ url: string }> {
    const conta = await this.contaAtual();
    if (!conta.stripeCustomerId) {
      throw new BadRequestException(
        'Esta empresa ainda não tem assinatura pra gerenciar.',
      );
    }

    try {
      const sessao = await this.stripe().billingPortal.sessions.create({
        customer: conta.stripeCustomerId,
        return_url: `${this.urlBase()}/dashboard/settings/account`,
      });
      return { url: sessao.url };
    } catch (erro) {
      if (!clienteSumiu(erro)) throw erro;
      await this.esquecerClienteDoStripe(conta.id, conta.stripeCustomerId);
      throw new BadRequestException(
        'Não encontramos a sua assinatura no Stripe. Recarregue a página e assine de novo.',
      );
    }
  }

  /**
   * Apaga da conta o cliente (e a assinatura) que o Stripe não conhece.
   *
   * Acontece quando a chave muda de modo teste pra produção: os `cus_` e
   * `sub_` guardados eram do outro mundo. A assinatura vai junto porque
   * um cliente inexistente não tem assinatura real — mantê-la faria a
   * empresa parecer pagante pra sempre, sem nunca ser cobrada. Quem
   * estiver liberado à mão ou for da plataforma continua liberado (ver
   * decidirAcesso).
   */
  private async esquecerClienteDoStripe(contaId: string, clienteId: string) {
    this.logger.warn(
      `Cliente ${clienteId} não existe neste Stripe (tenant ${this.prisma.tenantId}) — esquecido; a empresa assina como cliente novo.`,
    );
    await this.global.client.billingAccount.update({
      where: { id: contaId },
      data: {
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        planLabel: 'Grátis',
      },
    });
  }

  /** Confere que o webhook veio mesmo do Stripe antes de confiar em uma vírgula do corpo. */
  verificarAssinatura(corpoCru: Buffer, assinatura: string): Stripe.Event {
    const segredo = process.env.STRIPE_WEBHOOK_SECRET;
    if (!segredo) {
      throw new BadRequestException(
        'Webhook do Stripe não está configurado nesta instalação.',
      );
    }
    try {
      return this.stripe().webhooks.constructEvent(
        corpoCru,
        assinatura,
        segredo,
      );
    } catch (erro) {
      this.logger.warn(
        `Assinatura do webhook do Stripe recusada: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      throw new BadRequestException('Assinatura inválida.');
    }
  }

  /**
   * O que muda em `BillingAccount` quando o Stripe avisa alguma coisa.
   *
   * `checkout.session.completed` cobre dois casos, diferenciados por
   * `mode`: uma assinatura nascendo (`subscription` — é dali que sai o
   * vínculo entre o cliente do Stripe e o tenant, que os outros eventos
   * usam pra achar a linha certa) ou um pacote avulso de mensagens sendo
   * pago (`payment` — ver criarCheckoutExtra). Os dois eventos de
   * assinatura (mudança e cancelamento) decidem se a carência começa,
   * continua ou termina.
   */
  async processarEvento(evento: Stripe.Event): Promise<void> {
    switch (evento.type) {
      case 'checkout.session.completed': {
        const sessao = evento.data.object;
        const tenantId = sessao.client_reference_id;
        if (!tenantId) {
          this.logger.warn(
            'checkout.session.completed sem client_reference_id — evento ignorado.',
          );
          return;
        }

        if (sessao.mode === 'payment') {
          const quantidade = quantidadePaga(sessao.metadata);
          const resultado = await this.global.client.billingAccount.updateMany({
            where: { tenantId },
            data: {
              aiExtraMessagesThisPeriod: { increment: quantidade },
            },
          });
          if (resultado.count === 0) {
            this.logger.warn(
              `Pacote extra pago pro tenant ${tenantId}, sem BillingAccount correspondente.`,
            );
            return;
          }
          this.logger.log(
            `Pacote extra de ${quantidade} mensagens creditado pro tenant ${tenantId}.`,
          );
          await this.eventos?.registrar('pacote_pago', {
            tenantId,
            chave: `pacote:${sessao.id}`,
          });
          return;
        }

        const customerId =
          typeof sessao.customer === 'string'
            ? sessao.customer
            : sessao.customer?.id;
        const subscriptionId =
          typeof sessao.subscription === 'string'
            ? sessao.subscription
            : sessao.subscription?.id;
        if (!customerId || !subscriptionId) {
          this.logger.warn(
            `checkout.session.completed sem customer/subscription pro tenant ${tenantId} — evento ignorado.`,
          );
          return;
        }

        await this.global.client.billingAccount.upsert({
          where: { tenantId },
          create: {
            tenantId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            planLabel: 'Assinatura ativa',
          },
          update: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            planLabel: 'Assinatura ativa',
            assinaturaVencidaEm: null,
          },
        });
        this.logger.log(`Assinatura criada pro tenant ${tenantId}.`);
        await this.eventos?.registrar('assinatura_ativa', {
          tenantId,
          chave: `assinatura:${subscriptionId}`,
        });
        return;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const assinatura = evento.data.object;
        const customerId =
          typeof assinatura.customer === 'string'
            ? assinatura.customer
            : assinatura.customer.id;

        const conta = await this.global.client.billingAccount.findFirst({
          where: { stripeCustomerId: customerId },
        });
        if (!conta) {
          this.logger.warn(
            `Evento de assinatura pro cliente Stripe ${customerId}, sem BillingAccount correspondente.`,
          );
          return;
        }

        // "active" e "trialing" contam como em dia; qualquer outra coisa
        // (cancelada, inadimplente, incompleta) não. O Stripe já cuida de
        // tentar cobrar de novo antes de chegar num status ruim — aqui só
        // se reflete o que ele decidiu.
        const emDia =
          assinatura.status === 'active' || assinatura.status === 'trialing';
        const cancelada = evento.type === 'customer.subscription.deleted';

        await this.global.client.billingAccount.update({
          where: { id: conta.id },
          data: {
            stripeSubscriptionId: emDia ? assinatura.id : null,
            planLabel: emDia
              ? 'Assinatura ativa'
              : cancelada
                ? 'Cancelada'
                : 'Pagamento pendente',
            // Recupera, limpa o relógio. Fica ruim pela primeira vez, o
            // relógio começa agora. Já estava ruim, o relógio FICA — uma
            // nova tentativa de cobrança falhando de novo não pode
            // reiniciar a carência e esticar o prazo pra sempre.
            ...(emDia
              ? { assinaturaVencidaEm: null }
              : conta.assinaturaVencidaEm
                ? {}
                : { assinaturaVencidaEm: new Date() }),
          },
        });
        this.logger.log(
          `Assinatura do tenant ${conta.tenantId} atualizada: ${assinatura.status}.`,
        );
        // Uma vez por assinatura: o Stripe repete estes eventos a cada
        // tentativa de cobrança, e o painel conta cancelamentos, não avisos.
        if (cancelada) {
          await this.eventos?.registrar('assinatura_cancelada', {
            tenantId: conta.tenantId,
            chave: `cancelada:${assinatura.id}`,
          });
        } else if (!emDia && !conta.assinaturaVencidaEm) {
          await this.eventos?.registrar('pagamento_pendente', {
            tenantId: conta.tenantId,
            chave: `pendente:${assinatura.id}:${new Date().toISOString().slice(0, 10)}`,
          });
        }
        return;
      }

      default:
        // Outros eventos (fatura paga, tentativa de cobrança) não mudam
        // nada aqui hoje — o Stripe é quem decide reagir a eles.
        return;
    }
  }
}
