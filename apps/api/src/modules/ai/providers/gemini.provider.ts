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
  private readonly model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  private client: GoogleGenAI | null = null;

  /** Lazy: não derruba o boot da aplicação se a chave ainda não foi configurada. */
  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY não configurada. Defina essa variável de ambiente pra IA responder de verdade.',
      );
    }
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  async generateReply({ systemPrompt, history }: AiGenerateInput): Promise<AiGenerateResult> {
    const client = this.getClient();

    const contents = history.map((message) => ({
      role: toGeminiRole(message.role),
      parts: [{ text: message.content }],
    }));

    try {
      const response = await client.models.generateContent({
        model: this.model,
        contents,
        config: { systemInstruction: systemPrompt },
      });

      const text = response.text?.trim();
      if (!text) {
        throw new Error('A IA retornou uma resposta vazia.');
      }

      return { content: text };
    } catch (error) {
      this.logger.error(`Falha ao chamar o Gemini (${this.model})`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }
}
