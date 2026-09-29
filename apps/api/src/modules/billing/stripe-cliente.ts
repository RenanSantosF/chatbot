import { BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';

let cliente: Stripe | null = null;

/**
 * O cliente do Stripe pra quem age FORA de uma empresa (o painel da
 * plataforma). O BillingService tem o dele, preso ao tenant da requisição;
 * a chave é a mesma (`STRIPE_SECRET_KEY`), da conta Stripe da plataforma.
 */
export function clienteStripe(): Stripe {
  if (cliente) return cliente;
  const chave = process.env.STRIPE_SECRET_KEY;
  if (!chave) {
    throw new BadRequestException(
      'O Stripe não está configurado nesta instalação.',
    );
  }
  cliente = new Stripe(chave);
  return cliente;
}
