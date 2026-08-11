import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Client "cru", sem isolamento de tenant. Use apenas nos poucos pontos que
   * legitimamente operam antes de um tenant existir ou fora de um tenant
   * conhecido (registro, login, lookup do próprio Tenant). Para qualquer
   * outra coisa, injete TenantPrismaService.
   */
  readonly client: PrismaClient;

  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    this.client = new PrismaClient({ adapter });
  }

  async onModuleInit() {
    await this.client.$connect();
    this.logger.log('Conectado ao Postgres');
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
