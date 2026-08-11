import { Injectable } from '@nestjs/common';
import { EncryptionService } from '../../../common/crypto/encryption.service';
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
 * usam a MESMA chave do tenant, então essa lógica não pode viver duplicada
 * em cada um.
 */
@Injectable()
export class AiCredentialsResolver {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async resolve(): Promise<AiResolution> {
    const settings = await this.tenantPrisma.db.aiSettings.findFirst();
    const active = !settings || settings.active;

    if (settings?.apiKeyEncrypted) {
      return {
        active,
        credentials: { apiKey: this.encryption.decrypt(settings.apiKeyEncrypted), model: settings.model ?? undefined },
      };
    }

    // Fallback só pra desenvolvimento local — em produção cada tenant tem
    // que configurar a própria chave, nunca compartilhar a da plataforma.
    if (process.env.GEMINI_API_KEY) {
      return {
        active,
        credentials: { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL },
      };
    }

    return { active, credentials: null };
  }
}
