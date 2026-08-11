import { Inject, Injectable, Scope, UnauthorizedException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { AuthenticatedRequest } from '../../modules/auth/auth.types';
import { PrismaService } from './prisma.service';
import { applyTenantScope } from './tenant-scope.extension';

/**
 * Provider request-scoped: uma instância nova por requisição HTTP, criada já
 * sabendo o tenantId do usuário autenticado (preenchido pelo JwtAuthGuard
 * antes de qualquer controller rodar). É a forma central de garantir
 * isolamento — todo módulo de negócio (users, customers, conversations...)
 * injeta isso em vez de PrismaService diretamente, e nunca precisa lembrar
 * de filtrar tenantId manualmente.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  constructor(
    @Inject(REQUEST) private readonly request: AuthenticatedRequest,
    private readonly prisma: PrismaService,
  ) {}

  get tenantId(): string {
    const tenantId = this.request.user?.tenantId;
    if (!tenantId) {
      throw new UnauthorizedException('Nenhum tenant autenticado nesta requisição.');
    }
    return tenantId;
  }

  get db() {
    return applyTenantScope(this.prisma.client, this.tenantId);
  }
}
