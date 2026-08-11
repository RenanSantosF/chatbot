import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: TenantPrismaService) {}

  /**
   * Não recebe tenantId por parâmetro de propósito: TenantPrismaService já
   * sabe o tenant da requisição atual e filtra tudo automaticamente. Chamar
   * isso fora de uma requisição autenticada lança erro, não retorna dado de
   * outra empresa.
   */
  async listTeam() {
    return this.prisma.db.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        avatar: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
