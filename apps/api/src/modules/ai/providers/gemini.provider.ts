import { Injectable, Logger } from '@nestjs/common';
import type { Content } from '@google/genai';
import { GoogleGenAI } from '@google/genai';
import type {
  AiEmbedInput,
  AiEmbeddingProvider,
  AiGenerateInput,
  AiGenerateResult,
  AiMessage,
  AiProvider,
} from './ai-provider.interface';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 768;

/** Limite de idas-e-voltas de ferramenta numa única resposta — evita loop infinito se o modelo insistir em chamar ferramentas. */
const MAX_TOOL_TURNS = 4;

function toGeminiRole(role: AiMessage['role']): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user';
}

@Injectable()
export class GeminiProvider implements AiProvider, AiEmbeddingProvider {
  private readonly logger = new Logger(GeminiProvider.name);

  async generateReply({
    systemPrompt,
    history,
    apiKey,
    model,
    tools,
    executeTool,
  }: AiGenerateInput): Promise<AiGenerateResult> {
    const client = new GoogleGenAI({ apiKey });
    const resolvedModel = model ?? DEFAULT_MODEL;

    const contents: Content[] = history.map((message) => ({
      role: toGeminiRole(message.role),
      parts: [{ text: message.content }],
    }));

    const geminiTools = tools?.length
      ? [
          {
            functionDeclarations: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.parametersSchema,
            })),
          },
        ]
      : undefined;

    try {
      for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
        const response = await client.models.generateContent({
          model: resolvedModel,
          contents,
          config: { systemInstruction: systemPrompt, tools: geminiTools },
        });

        const calls = response.functionCalls;

        if (!calls || calls.length === 0) {
          const text = response.text?.trim();
          if (!text) {
            throw new Error('A IA retornou uma resposta vazia.');
          }
          return { content: text };
        }

        if (!executeTool) {
          throw new Error('A IA tentou usar uma ferramenta, mas nenhum executor foi configurado.');
        }

        // Preserva o turno exato do modelo (com a chamada de função) antes
        // de anexar as respostas — o protocolo do Gemini exige isso pra
        // manter o histórico coerente na próxima chamada.
        const modelTurn = response.candidates?.[0]?.content;
        if (modelTurn) {
          contents.push(modelTurn);
        }

        for (const call of calls) {
          const name = call.name ?? '';
          const result = await executeTool(name, call.args ?? {});
          contents.push({
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name,
                  id: call.id,
                  response: result.error ? { error: result.error } : { output: result.output ?? null },
                },
              },
            ],
          });
        }
      }

      throw new Error('A IA excedeu o limite de chamadas de ferramenta nesta resposta.');
    } catch (error) {
      this.logger.error(
        `Falha ao chamar o Gemini (${resolvedModel})`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  async embed({ texts, apiKey, taskType }: AiEmbedInput): Promise<number[][]> {
    const client = new GoogleGenAI({ apiKey });

    try {
      const response = await client.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: texts,
        config: { taskType, outputDimensionality: EMBEDDING_DIMENSIONS },
      });

      const embeddings = response.embeddings ?? [];
      if (embeddings.length !== texts.length) {
        throw new Error(
          `Esperava ${texts.length} embeddings, recebi ${embeddings.length} do Gemini.`,
        );
      }

      return embeddings.map((embedding) => embedding.values ?? []);
    } catch (error) {
      this.logger.error(
        `Falha ao gerar embeddings (${EMBEDDING_MODEL})`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }
}
