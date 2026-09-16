import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../../common/prisma/tenant-prisma.service';

export interface AiCredentials {
  apiKey: string;
  model?: string;
}

export interface AiResolution {
  /** Interruptor geral do tenant (Configurações > IA). Falso = IA nunca deve agir, mesmo com chave configurada. */
  active: boolean;
  credentials: AiCredentials | null;
}

/**
 * Única fonte de verdade pra "qual credencial de IA usar nesta requisição".
 * Usado tanto pra gerar respostas de chat (AiEngineService) quanto pra
 * gerar embeddings da base de conhecimento (KnowledgeService) — os dois
 * usam a MESMA chave, então essa lógica não pode viver duplicada em cada
 * um.
 *
 * A chave é da PLATAFORMA, não do tenant: uma única `GEMINI_API_KEY` paga
 * por nós e configurada por variável de ambiente, nunca cadastrada pela
 * empresa. Isso simplifica o onboarding (a empresa só liga a IA, não
 * precisa ter conta no Google) e é o que permite cobrar por assinatura em
 * vez de repassar custo de provedor.
 */
@Injectable()
export class AiCredentialsResolver {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async resolve(): Promise<AiResolution> {
    const settings = await this.tenantPrisma.db.aiSettings.findFirst();
    const active = !settings || settings.active;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { active, credentials: null };
    }

    return {
      active,
      credentials: { apiKey, model: process.env.GEMINI_MODEL },
    };
  }
}
