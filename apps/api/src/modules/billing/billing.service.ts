import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

/**
 * Dois dias entre a assinatura ficar em atraso e o acesso ser cortado.
 *
 * Curto o bastante pra não virar um mês de uso de graça, longo o
 * bastante pra dar tempo de trocar um cartão vencido sem que a empresa
 * perca atendimentos no meio do caminho — o Stripe já tenta cobrar de
 * novo automaticamente antes de chegar aqui, então quem chega neste
 * relógio é quem realmente precisa agir.
 */
const DIAS_DE_CARENCIA = 2;
const CARENCIA_MS = DIAS_DE_CARENCIA * 24 * 60 * 60 * 1000;

/**
 * Quantas respostas o pacote avulso acrescenta, e por quanto.
 *
 * Um pacote só, de propósito — dar a escolher quantidade era resolver um
 * problema que ninguém tem ainda (o plano mensal já cobre uso normal
 * sobrando; ver o comentário em AiUsageService). R$49,90 por 1.000
 * respostas fica em torno de R$0,05 por resposta, contra um custo real de
 * provedor de menos de um centavo — a mesma margem generosa do plano
 * mensal, só que fatiada pra quem precisa de um empurrão no meio do mês.
 */
const MENSAGENS_POR_PACOTE_EXTRA = 1000;

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

  async status() {
    const conta = await this.contaAtual();
    return {
      assinaturaAtiva: Boolean(conta.stripeSubscriptionId),
      planLabel: conta.planLabel,
      ...this.statusDeAcesso(conta),
    };
  }

  /**
   * Se esta empresa pode usar o sistema agora, e por quê.
   *
   * Função pura sobre os dois campos que decidem tudo — sem consulta ao
   * banco aqui dentro — pra o mesmo cálculo servir tanto o guard que
   * bloqueia requisição (BillingGuard) quanto a tela que mostra o aviso
   * (AuthController.me), sem duplicar a régua em dois lugares.
   *
   * Uma conta que nunca assinou (`assinaturaVencidaEm` nulo e sem
   * assinatura) fica bloqueada direto, sem carência — carência é o prazo
   * pra quem já pagava resolver um problema de cobrança, não um período
   * de teste grátis disfarçado.
   */
  statusDeAcesso(conta: {
    stripeSubscriptionId: string | null;
    assinaturaVencidaEm: Date | null;
  }): {
    bloqueado: boolean;
    emCarencia: boolean;
    vencidoDesde: number | null;
    bloqueiaEm: number | null;
  } {
    if (conta.stripeSubscriptionId) {
      return {
        bloqueado: false,
        emCarencia: false,
        vencidoDesde: null,
        bloqueiaEm: null,
      };
    }

    if (!conta.assinaturaVencidaEm) {
      return {
        bloqueado: true,
        emCarencia: false,
        vencidoDesde: null,
        bloqueiaEm: null,
      };
    }

    const bloqueiaEm = conta.assinaturaVencidaEm.getTime() + CARENCIA_MS;
    const bloqueado = Date.now() >= bloqueiaEm;
    return {
      bloqueado,
      emCarencia: !bloqueado,
      vencidoDesde: conta.assinaturaVencidaEm.getTime(),
      bloqueiaEm,
    };
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
    const dono = conta.stripeCustomerId
      ? null
      : await this.global.client.user.findFirst({
          where: { tenantId, role: 'OWNER' },
          select: { email: true },
        });

    const sessao = await this.stripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: precoId, quantity: 1 }],
      // É como o webhook liga o evento de volta a ESTA empresa (ver
      // processarEvento) — o Stripe não sabe nada sobre tenant.
      client_reference_id: tenantId,
      ...(conta.stripeCustomerId
        ? { customer: conta.stripeCustomerId }
        : dono?.email
          ? { customer_email: dono.email }
          : {}),
      success_url: `${base}/dashboard/settings/account?assinatura=sucesso`,
      cancel_url: `${base}/dashboard/settings/account?assinatura=cancelada`,
    });

    if (!sessao.url) {
      throw new BadRequestException(
        'Não deu pra criar a sessão de pagamento agora. Tente de novo.',
      );
    }
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
  async criarCheckoutExtra(): Promise<{ url: string }> {
    const precoId = process.env.STRIPE_TOPUP_PRICE_ID;
    if (!precoId) {
      throw new BadRequestException(
        'Pacote de mensagens extras não está configurado nesta instalação. Fale com o suporte.',
      );
    }

    const conta = await this.contaAtual();
    if (!conta.stripeCustomerId) {
      throw new BadRequestException(
        'Esta empresa ainda não tem assinatura — assine antes de comprar um pacote extra.',
      );
    }

    const base = this.urlBase();
    const sessao = await this.stripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: precoId, quantity: 1 }],
      client_reference_id: this.prisma.tenantId,
      customer: conta.stripeCustomerId,
      success_url: `${base}/dashboard/settings/ai?pacoteExtra=sucesso`,
      cancel_url: `${base}/dashboard/settings/ai?pacoteExtra=cancelado`,
    });

    if (!sessao.url) {
      throw new BadRequestException(
        'Não deu pra criar a sessão de pagamento agora. Tente de novo.',
      );
    }
    return { url: sessao.url };
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

    const sessao = await this.stripe().billingPortal.sessions.create({
      customer: conta.stripeCustomerId,
      return_url: `${this.urlBase()}/dashboard/settings/account`,
    });
    return { url: sessao.url };
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
          const resultado = await this.global.client.billingAccount.updateMany({
            where: { tenantId },
            data: {
              aiExtraMessagesThisPeriod: {
                increment: MENSAGENS_POR_PACOTE_EXTRA,
              },
            },
          });
          if (resultado.count === 0) {
            this.logger.warn(
              `Pacote extra pago pro tenant ${tenantId}, sem BillingAccount correspondente.`,
            );
            return;
          }
          this.logger.log(
            `Pacote extra de ${MENSAGENS_POR_PACOTE_EXTRA} mensagens creditado pro tenant ${tenantId}.`,
          );
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
        return;
      }

      default:
        // Outros eventos (fatura paga, tentativa de cobrança) não mudam
        // nada aqui hoje — o Stripe é quem decide reagir a eles.
        return;
    }
  }
}
