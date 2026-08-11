import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

interface FindOrCreateInput {
  phone: string;
  name: string;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: TenantPrismaService) {}

  async list() {
    return this.prisma.db.customer.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getById(id: string) {
    return this.prisma.db.customer.findFirst({ where: { id } });
  }

  /**
   * Ponto de entrada de qualquer canal (hoje só o simulador; WhatsApp na
   * Fase 7 chama isto também). Telefone identifica o cliente dentro do
   * tenant — cria o cadastro na primeira mensagem, reaproveita depois.
   */
  async findOrCreateByPhone({ phone, name }: FindOrCreateInput) {
    const existing = await this.prisma.db.customer.findFirst({ where: { phone } });
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.db.customer.create({
        data: { tenantId: this.prisma.tenantId, phone, name },
      });
    } catch (error) {
      // Corrida entre duas mensagens quase simultâneas do mesmo número novo.
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const existingAfterRace = await this.prisma.db.customer.findFirst({ where: { phone } });
        if (existingAfterRace) {
          return existingAfterRace;
        }
      }
      throw error;
    }
  }
}
