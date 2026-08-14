import { Global, Module } from '@nestjs/common';
import { HealthController } from '../health/health.controller';
import { PrismaService } from './prisma.service';
import { TenantPrismaService } from './tenant-prisma.service';

@Global()
@Module({
  // O health check mora aqui porque a única coisa de que ele depende é o
  // client do Prisma — um módulo só pra duas rotas seria cerimônia.
  controllers: [HealthController],
  providers: [PrismaService, TenantPrismaService],
  exports: [PrismaService, TenantPrismaService],
})
export class PrismaModule {}
