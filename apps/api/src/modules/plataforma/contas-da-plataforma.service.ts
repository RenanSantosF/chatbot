import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { novaLiberacao, proximaCobrancaAdiada } from '../billing/acesso';
import { clienteStripe } from '../billing/stripe-cliente';
import { StorageService } from '../storage/storage.service';
import { ApagadorDeEmpresa } from '../tenants/apagador-de-empresa';
import { emailsDaPlataforma } from './plataforma.guard';
import { RegistroDeEventos } from './registro-de-eventos.service';

/** Até um ano por vez: o Stripe não aceita adiar cobrança pra muito longe. */
export const MAXIMO_DE_DIAS = 365;

export interface ResultadoDaLiberacao {
  liberadoAte: Date;
  /** A nova data da próxima cobrança, quando ela foi adiada no Stripe. */
  cobrancaAdiadaPara: Date | null;
  /** O que não deu certo e precisa de atenção (ex.: o Stripe recusou). */
  aviso: string | null;
}

/**
 * O que o dono da plataforma faz com uma conta: liberar dias, tirar a
 * liberação e apagar.
 *
 * O cuidado aqui é não deixar a liberação manual e o Stripe brigarem. A
 * regra de quem vence é uma só (ver decidirAcesso): a liberação manual
 * vale acima do Stripe enquanto dura. Adiar a cobrança no Stripe é
 * OPCIONAL e separado — liberar acesso não mexe em cobrança nenhuma a
 * menos que isso seja pedido.
 */
@Injectable()
export class ContasDaPlataforma {
  private readonly logger = new Logger(ContasDaPlataforma.name);
  private readonly apagador: ApagadorDeEmpresa;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: RegistroDeEventos,
    storage: StorageService,
    encryption: EncryptionService,
  ) {
    this.apagador = new ApagadorDeEmpresa(prisma, storage, encryption);
  }

  private async empresa(tenantId: string) {
    const empresa = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        billing: {
          select: {
            id: true,
            stripeSubscriptionId: true,
            liberadoAte: true,
          },
        },
      },
    });
    if (!empresa) throw new NotFoundException('Conta não encontrada.');
    return empresa;
  }

  /**
   * Libera `dias` de acesso — somados ao que ainda falta, se já houver.
   *
   * Com `adiarCobranca` e uma assinatura ativa, empurra também a próxima
   * cobrança do Stripe em `dias` (pra quem pagou por fora, ou ganhou dias
   * de folga). É feito pelo `trial_end` da assinatura, sem cobrança
   * proporcional: o Stripe passa a assinatura pra "em teste" até a nova
   * data e cobra dali em diante, no ciclo normal.
   *
   * A ordem protege contra o Stripe falhar no meio: o acesso é gravado
   * PRIMEIRO. Se o adiamento der errado, a empresa continua liberada e o
   * aviso volta pra tela — nunca o contrário (cobrança adiada e acesso
   * cortado).
   */
  async liberar(
    tenantId: string,
    {
      dias,
      nota,
      adiarCobranca = false,
    }: { dias: number; nota?: string; adiarCobranca?: boolean },
    porQuem: string,
  ): Promise<ResultadoDaLiberacao> {
    if (!Number.isInteger(dias) || dias < 1 || dias > MAXIMO_DE_DIAS) {
      throw new BadRequestException(`Escolha de 1 a ${MAXIMO_DE_DIAS} dias.`);
    }
    const empresa = await this.empresa(tenantId);
    const subscriptionId = empresa.billing?.stripeSubscriptionId ?? null;

    let liberadoAte = novaLiberacao(empresa.billing?.liberadoAte, dias);
    let cobrancaAdiadaPara: Date | null = null;
    let aviso: string | null = null;

    if (adiarCobranca && subscriptionId) {
      try {
        const stripe = clienteStripe();
        const assinatura = await stripe.subscriptions.retrieve(subscriptionId);
        // Só mexe em assinatura saudável. Numa com pagamento pendente, a
        // fatura em aberto continuaria sendo cobrada mesmo com o adiamento
        // — ali quem decide é o Stripe (ou você, direto nele).
        if (
          assinatura.status !== 'active' &&
          assinatura.status !== 'trialing'
        ) {
          aviso = `A assinatura no Stripe está "${assinatura.status}"; só o acesso foi liberado, a cobrança não foi mexida.`;
        } else {
          const adiada = proximaCobrancaAdiada(
            {
              trialEnd: assinatura.trial_end,
              fimDoPeriodo:
                assinatura.items.data[0]?.current_period_end ?? null,
            },
            dias,
          );
          await stripe.subscriptions.update(subscriptionId, {
            trial_end: Math.floor(adiada.getTime() / 1000),
            proration_behavior: 'none',
          });
          cobrancaAdiadaPara = adiada;
          // O acesso acompanha a cobrança: libera ao menos até ela.
          if (adiada > liberadoAte) liberadoAte = adiada;
        }
      } catch (erro) {
        const motivo = erro instanceof Error ? erro.message : String(erro);
        this.logger.warn(
          `Não deu pra adiar a cobrança de ${tenantId} no Stripe: ${motivo}`,
        );
        aviso = `O acesso foi liberado, mas o Stripe recusou adiar a cobrança (${motivo}). Ajuste direto no Stripe, se precisar.`;
      }
    }

    const notaLimpa = nota?.trim().slice(0, 200) || null;
    await this.prisma.client.billingAccount.upsert({
      where: { tenantId },
      create: { tenantId, liberadoAte, liberadoNota: notaLimpa },
      update: { liberadoAte, liberadoNota: notaLimpa },
    });

    await this.eventos.registrar('liberacao_manual', {
      tenantId,
      dados: {
        dias,
        ate: liberadoAte.toISOString(),
        cobrancaAdiadaPara: cobrancaAdiadaPara?.toISOString() ?? null,
        porQuem,
        nota: notaLimpa,
      },
    });
    this.logger.log(
      `Conta ${tenantId} liberada por ${dias} dias (até ${liberadoAte.toISOString()}) por ${porQuem}.`,
    );

    return { liberadoAte, cobrancaAdiadaPara, aviso };
  }

  /**
   * Tira a liberação manual. Não mexe no Stripe: uma cobrança adiada
   * continua adiada (desfazer isso cobraria o cliente na hora, e não é o
   * tipo de coisa que se faz sem querer). A tela avisa disso.
   */
  async revogar(tenantId: string, porQuem: string) {
    const empresa = await this.empresa(tenantId);
    if (!empresa.billing?.liberadoAte) return { ok: true };

    await this.prisma.client.billingAccount.update({
      where: { tenantId },
      data: { liberadoAte: null, liberadoNota: null },
    });
    await this.eventos.registrar('liberacao_revogada', {
      tenantId,
      dados: { porQuem },
    });
    return {
      ok: true,
      tinhaAssinatura: Boolean(empresa.billing.stripeSubscriptionId),
    };
  }

  /**
   * Apaga a conta inteira — na ordem que não deixa cobrança órfã.
   *
   *   1. Confere o nome digitado (a mesma prova da tela da própria empresa).
   *   2. Não apaga a conta do dono da plataforma (trancaria quem apaga).
   *   3. Cancela a assinatura no Stripe e ESPERA a confirmação dele. Se o
   *      Stripe falhar, para aqui: melhor uma conta viva que ninguém quer
   *      do que o cartão de alguém sendo cobrado por uma conta que sumiu.
   *   4. Só então apaga (ver ApagadorDeEmpresa).
   */
  async apagar(tenantId: string, confirmacao: string, porQuem: string) {
    const empresa = await this.empresa(tenantId);

    const digitado = confirmacao.trim().toLocaleLowerCase('pt-BR');
    if (digitado !== empresa.name.trim().toLocaleLowerCase('pt-BR')) {
      throw new BadRequestException(
        `Pra confirmar, digite exatamente o nome da empresa: ${empresa.name}`,
      );
    }

    const lista = emailsDaPlataforma();
    if (lista.length) {
      const donos = await this.prisma.client.user.count({
        where: { tenantId, email: { in: lista, mode: 'insensitive' } },
      });
      if (donos > 0) {
        throw new ConflictException(
          'Esta é a conta de um dono da plataforma — apagá-la tiraria o seu próprio acesso.',
        );
      }
    }

    if (this.apagador.emAndamento(tenantId)) {
      throw new ConflictException('Esta conta já está sendo apagada.');
    }

    const subscriptionId = empresa.billing?.stripeSubscriptionId;
    if (subscriptionId) {
      try {
        const cancelada = await clienteStripe().subscriptions.cancel(
          subscriptionId,
          {
            prorate: false,
            invoice_now: false,
          },
        );
        if (cancelada.status !== 'canceled') {
          throw new Error(
            `o Stripe devolveu a assinatura como "${cancelada.status}"`,
          );
        }
      } catch (erro) {
        const motivo = erro instanceof Error ? erro.message : String(erro);
        // Assinatura que o Stripe já não conhece não cobra ninguém: segue.
        if (!/No such subscription/i.test(motivo)) {
          throw new ConflictException(
            `Não deu pra cancelar a assinatura no Stripe (${motivo}). A conta NÃO foi apagada — cancele no Stripe e tente de novo.`,
          );
        }
      }
      // A partir daqui a linha não tem mais assinatura: se o apagamento
      // falhar no meio, a conta fica sem cobrança, e não com uma cobrança
      // que ninguém mais controla.
      await this.prisma.client.billingAccount.update({
        where: { tenantId },
        data: { stripeSubscriptionId: null, planLabel: 'Cancelada' },
      });
    }

    await this.eventos.registrar('conta_apagada', {
      tenantId,
      dados: { nome: empresa.name, porQuem },
    });
    return this.apagador.apagar(tenantId, { nome: empresa.name, porQuem });
  }
}
