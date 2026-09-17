import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BillingExempt } from '../../common/billing/billing-exempt.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';
import { BillingService } from './billing.service';

/**
 * A assinatura, do lado de quem administra a empresa.
 *
 * Só o dono — mesma régua de AccountController: decidir se a empresa
 * paga, e como, é uma ordem de decisão diferente de configurar a
 * operação.
 *
 * `@BillingExempt()` no controller inteiro: é exatamente esta rota que
 * uma empresa bloqueada precisa alcançar pra deixar de estar bloqueada
 * (ver BillingGuard) — travar o próprio Checkout seria fechar a porta de
 * saída do bloqueio.
 */
@Controller('billing')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OWNER')
@BillingExempt()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('status')
  status() {
    return this.billing.status();
  }

  @Post('checkout')
  checkout() {
    return this.billing.criarCheckout();
  }

  @Post('checkout-extra')
  checkoutExtra() {
    return this.billing.criarCheckoutExtra();
  }

  @Post('portal')
  portal() {
    return this.billing.criarPortal();
  }
}
