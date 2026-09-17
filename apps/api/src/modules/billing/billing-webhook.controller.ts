import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service';

/**
 * Onde o Stripe avisa que uma assinatura nasceu, mudou ou morreu.
 *
 * Sem guarda de tenant nenhuma — o Stripe não sabe o que é um tenant, e é
 * o `client_reference_id`/`customer` de cada evento que liga de volta pra
 * empresa certa (ver BillingService.processarEvento). Quem protege esta
 * rota é a assinatura HMAC do cabeçalho `stripe-signature`, não login
 * nenhum: um corpo sem ela, ou com uma assinatura que não bate, nunca
 * chega a ser processado.
 */
@Controller('webhooks/stripe')
export class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Post()
  async receber(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') assinatura?: string,
  ) {
    if (!req.rawBody || !assinatura) {
      throw new BadRequestException('Requisição sem assinatura.');
    }

    const evento = this.billing.verificarAssinatura(req.rawBody, assinatura);
    await this.billing.processarEvento(evento);
    return { received: true };
  }
}
