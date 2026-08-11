import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import type { AiGenerateInput, AiGenerateResult, AiMessage, AiProvider } from './ai-provider.interface';

const DEFAULT_MODEL = 'gemini-2.5-flash';

function toGeminiRole(role: AiMessage['role']): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user';
}

@Injectable()
export class GeminiProvider implements AiProvider {
  private readonly logger = new Logger(GeminiProvider.name);

  async generateReply({ systemPrompt, history, apiKey, model }: AiGenerateInput): Promise<AiGenerateResult> {
    const client = new GoogleGenAI({ apiKey });
    const resolvedModel = model ?? DEFAULT_MODEL;

    const contents = history.map((message) => ({
      role: toGeminiRole(message.role),
      parts: [{ text: message.content }],
    }));

    try {
      const response = await client.models.generateContent({
        model: resolvedModel,
        contents,
        config: { systemInstruction: systemPrompt },
      });

      const text = response.text?.trim();
      if (!text) {
        throw new Error('A IA retornou uma resposta vazia.');
      }

      return { content: text };
    } catch (error) {
      this.logger.error(
        `Falha ao chamar o Gemini (${resolvedModel})`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }
}
