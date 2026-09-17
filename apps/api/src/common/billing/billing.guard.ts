import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Scope,
} from '@nestjs/common';
import type { CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import type { AuthenticatedRequest } from '../../modules/auth/auth.types';
import { BillingService } from '../../modules/billing/billing.service';
import { IS_BILLING_EXEMPT_KEY } from './billing-exempt.decorator';

/**
 * Corta o acesso de quem não paga — sem trial, e com carência só pra
 * quem já pagava e ficou em atraso (ver BillingService.statusDeAcesso).
 *
 * Fica por último na fila de guards globais (ver app.module.ts): é o mais
 * caro dos quatro, porque consulta o banco, então só vale a pena rodar
 * depois que Throttler/Jwt/Roles/Permissions já descartaram o que não
 * precisava chegar até aqui.
 *
 * Request-scoped porque BillingService depende do TenantPrismaService, que
 * já é por requisição — mesma razão do PermissionsGuard.
 */
@Injectable({ scope: Scope.REQUEST })
export class BillingGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly billing: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isento = this.reflector.getAllAndOverride<boolean>(
      IS_BILLING_EXEMPT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isento) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // Sem usuário autenticado, não é este guard quem decide — o JwtAuthGuard,
    // que roda antes, já teria barrado.
    if (!request.user) return true;

    const { bloqueado } = await this.billing.status();
    if (bloqueado) {
      throw new ForbiddenException(
        'A assinatura desta empresa está vencida. Regularize o pagamento para continuar usando o sistema.',
      );
    }
    return true;
  }
}
