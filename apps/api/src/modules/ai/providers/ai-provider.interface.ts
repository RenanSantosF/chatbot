export interface AiMessage {
  /** "assistant" cobre tanto resposta da IA quanto do atendente humano — pro LLM, ambos são "o negócio falando". */
  role: 'user' | 'assistant';
  content: string;
}

export interface AiGenerateInput {
  systemPrompt: string;
  history: AiMessage[];
  /** Credencial do TENANT, nunca uma chave compartilhada da plataforma. */
  apiKey: string;
  model?: string;
}

export interface AiGenerateResult {
  content: string;
}

/**
 * Contrato que qualquer provedor de LLM implementa. O resto do sistema (AI
 * Engine, tools, etc.) nunca importa OpenAI/Gemini/Anthropic diretamente —
 * só fala com esta interface. Trocar de provedor é trocar o binding do
 * token AI_PROVIDER, não reescrever lógica de negócio.
 */
export interface AiProvider {
  generateReply(input: AiGenerateInput): Promise<AiGenerateResult>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');
