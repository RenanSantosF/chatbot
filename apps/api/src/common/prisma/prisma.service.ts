import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
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
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: tamanhoDoPool(
        process.env.DATABASE_URL,
        process.env.DATABASE_POOL_MAX,
      ),
      // Conexão parada volta pro pooler em vez de ficar ocupando vaga.
      idleTimeoutMillis: 30_000,
    });
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

/**
 * Quantas conexões a API segura no máximo.
 *
 * Com o adaptador `pg`, o `connection_limit` da URL não vale mais nada —
 * quem manda é o pool do `pg`, que abre até 10 por padrão. Dividindo o
 * pooler gratuito do Supabase (15 clientes em modo sessão) com a
 * Evolution (8), 10 estourava: a tela de contagens dispara uma dezena de
 * consultas de uma vez, e foi ela que caiu com `EMAXCONNSESSION`.
 *
 * Ordem: `DATABASE_POOL_MAX`, depois o `connection_limit` da própria URL
 * (que o DEPLOY.md já mandava pôr), e 5 se nenhum dos dois vier.
 */
export function tamanhoDoPool(url?: string, env?: string): number {
  const valido = (bruto: string | null | undefined) => {
    const n = Number(bruto);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  let daUrl: number | null = null;
  try {
    daUrl = url
      ? valido(new URL(url).searchParams.get('connection_limit'))
      : null;
  } catch {
    daUrl = null;
  }
  return valido(env) ?? daUrl ?? 5;
}
