import { SetMetadata } from '@nestjs/common';

export const IS_BILLING_EXEMPT_KEY = 'isBillingExempt';

/**
 * Livre do bloqueio por assinatura vencida, mesmo com o usuário logado.
 *
 * Só pra rotas que a própria pessoa bloqueada precisa alcançar pra deixar
 * de estar bloqueada: ver o status da cobrança, abrir o Checkout/Portal
 * do Stripe, e sair da conta. Qualquer outra coisa do produto passa pelo
 * BillingGuard normalmente.
 */
export const BillingExempt = () => SetMetadata(IS_BILLING_EXEMPT_KEY, true);
