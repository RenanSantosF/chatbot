import { Injectable, Logger } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { UpdateAiSettingsDto } from './dto/update-ai-settings.dto';
import {
  MODELO_PADRAO,
  MODELOS_PREFERIDOS,
  ordenarModelos,
  type ModeloDisponivel,
} from './modelos';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Dez segundos. É uma tela de configuração, não um caminho de mensagem:
 * ninguém morre esperando, mas travar a tela num Google lento seria pior
 * que mostrar a lista recomendada.
 */
const TEMPO_LIMITE_MS = 10_000;

@Injectable()
export class AiSettingsService {
  private readonly logger = new Logger(AiSettingsService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * A chave criptografada nunca sai desse service — a resposta pública só
   * diz se tem chave configurada e os últimos 4 caracteres, pra o dono
   * confirmar qual chave está ativa sem reexibir o valor inteiro.
   */
  private toPublic<T extends { apiKeyEncrypted: string | null }>(settings: T) {
    const { apiKeyEncrypted, ...rest } = settings;
    return {
      ...rest,
      hasApiKey: Boolean(apiKeyEncrypted),
      apiKeyPreview: apiKeyEncrypted ? `••••${this.encryption.decrypt(apiKeyEncrypted).slice(-4)}` : null,
    };
  }

  /**
   * Todo tenant ganha AiSettings no registro (ver AuthService.register); o
   * upsert aqui é só uma rede de segurança pra tenants antigos de antes
   * desse modelo existir.
   */
  private async getRaw() {
    const existing = await this.prisma.db.aiSettings.findFirst();
    if (existing) {
      return existing;
    }
    return this.prisma.db.aiSettings.create({ data: { tenantId: this.prisma.tenantId } });
  }

  async get() {
    return this.toPublic(await this.getRaw());
  }

  /**
   * Os modelos que a chave DESTA empresa consegue usar.
   *
   * Perguntados ao Google, e não guardados numa lista aqui: ele lança e
   * aposenta modelo o tempo todo, e uma lista escrita no código passa a
   * mentir no dia seguinte ao deploy — foi por isso que este campo nasceu
   * como texto livre. A consulta resolve os dois lados: a tela deixa de
   * aceitar nome digitado errado e continua acompanhando o catálogo.
   *
   * Nunca lança. Sem chave configurada, ou com o Google fora do ar, a
   * resposta cai nos modelos recomendados — o seletor continua servindo
   * pra escolher, só não confirma disponibilidade. `verificado` diz qual
   * dos dois casos é, pra a tela poder avisar em vez de fingir certeza.
   */
  async listarModelos(): Promise<{
    modelos: ModeloDisponivel[];
    padrao: string;
    verificado: boolean;
  }> {
    const settings = await this.getRaw();
    // `padrao` vai junto pra a tela não precisar repetir a constante: dois
    // padrões escritos em dois lugares divergem, e o jeito de descobrir
    // seria o seletor mostrando um modelo e a API usando outro.
    const preferidos = {
      modelos: ordenarModelos([...MODELOS_PREFERIDOS]),
      padrao: MODELO_PADRAO,
      verificado: false,
    };

    if (!settings.apiKeyEncrypted) return preferidos;

    try {
      const resposta = await fetch(`${GEMINI_API}/models?pageSize=200`, {
        // No cabeçalho, e não na query: chave em querystring vaza pro log
        // de qualquer proxy no caminho.
        headers: {
          'x-goog-api-key': this.encryption.decrypt(settings.apiKeyEncrypted),
        },
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });

      if (!resposta.ok) {
        this.logger.warn(
          `O Google recusou a listagem de modelos (${resposta.status}). Usando a lista recomendada.`,
        );
        return preferidos;
      }

      const dados = (await resposta.json()) as {
        models?: { name?: string; supportedGenerationMethods?: string[] }[];
      };

      const ids = (dados.models ?? [])
        // `generateContent` é o que este produto chama. Sem esse filtro a
        // lista traria os modelos de embedding, que existem na mesma conta
        // e nunca vão responder a um cliente.
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => m.name?.replace(/^models\//, '') ?? '')
        .filter((id) => id.startsWith('gemini-'));

      if (ids.length === 0) return preferidos;

      return { modelos: ordenarModelos(ids), padrao: MODELO_PADRAO, verificado: true };
    } catch (erro) {
      this.logger.warn(
        `Não deu pra listar os modelos no Google: ${erro instanceof Error ? erro.message : String(erro)}. Usando a lista recomendada.`,
      );
      return preferidos;
    }
  }

  async update(dto: UpdateAiSettingsDto) {
    const current = await this.getRaw();
    const { apiKey, ...rest } = dto;

    const updated = await this.prisma.db.aiSettings.update({
      where: { id: current.id },
      data: {
        ...rest,
        ...(apiKey ? { apiKeyEncrypted: this.encryption.encrypt(apiKey) } : {}),
      },
    });

    return this.toPublic(updated);
  }

  async clearApiKey() {
    const current = await this.getRaw();
    const updated = await this.prisma.db.aiSettings.update({
      where: { id: current.id },
      data: { apiKeyEncrypted: null },
    });
    return this.toPublic(updated);
  }
}
