import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';
import { BillingService } from './billing.service';

/**
 * A assinatura, do lado de quem administra a empresa.
 *
 * Só o dono — mesma régua de AccountController: decidir se a empresa
 * paga, e como, é uma ordem de decisão diferente de configurar a
 * operação.
 */
@Controller('billing')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OWNER')
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

  @Post('portal')
  portal() {
    return this.billing.criarPortal();
  }
}
