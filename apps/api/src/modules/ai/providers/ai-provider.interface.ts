export interface AiMessage {
  /** "assistant" cobre tanto resposta da IA quanto do atendente humano — pro LLM, ambos são "o negócio falando". */
  role: 'user' | 'assistant';
  content: string;
}

/** Descrição de uma ferramenta que a IA pode decidir usar — nome, o que faz, e o formato dos parâmetros (JSON Schema). */
export interface AiToolDeclaration {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
}

export interface AiToolCallResult {
  output?: unknown;
  error?: string;
}

/**
 * Quem de fato roda a ferramenta quando a IA pede. O provider (Gemini, e
 * depois outros) chama isso e nunca sabe o que tem por trás — permissão,
 * execução do código nativo ou chamada HTTP customizada é tudo
 * responsabilidade de quem fornece esse executor (AiEngineService).
 */
export type AiToolExecutor = (name: string, args: Record<string, unknown>) => Promise<AiToolCallResult>;

export interface AiGenerateInput {
  systemPrompt: string;
  history: AiMessage[];
  /** Credencial do TENANT, nunca uma chave compartilhada da plataforma. */
  apiKey: string;
  model?: string;
  tools?: AiToolDeclaration[];
  executeTool?: AiToolExecutor;
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

export interface AiTranscribeInput {
  buffer: Buffer;
  /** O tipo declarado do arquivo. O modelo precisa dele pra decodificar. */
  mimeType: string;
  apiKey: string;
  model?: string | null;
}

/**
 * Ouvir o que o cliente falou.
 *
 * Contrato à parte de `AiProvider` pelo mesmo motivo dos embeddings: nem
 * todo provedor de conversa transcreve áudio na mesma conta, e obrigar
 * quem não transcreve a implementar um método que só sabe lançar é pior
 * que declarar a capacidade onde ela existe.
 *
 * Existe porque, sem ele, o áudio chegava ao modelo como
 * "[o cliente enviou um áudio, que você não consegue abrir]" — e num
 * escritório onde boa parte do cliente prefere falar a digitar, isso é
 * metade do atendimento que a IA não enxerga.
 */
export interface AiTranscriptionProvider {
  /** @returns o texto falado, ou null quando não deu pra entender nada. */
  transcribe(input: AiTranscribeInput): Promise<string | null>;
}

export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export interface AiEmbedInput {
  texts: string[];
  apiKey: string;
  taskType: EmbeddingTaskType;
}

/**
 * Capacidade separada de AiProvider de propósito: nem todo provedor de chat
 * necessariamente oferece embeddings sob a mesma conta/API (ex: Anthropic
 * não tem endpoint de embedding próprio) — então isso é um contrato à
 * parte, implementado por quem realmente suporta.
 */
export interface AiEmbeddingProvider {
  embed(input: AiEmbedInput): Promise<number[][]>;
}

export const AI_EMBEDDING_PROVIDER = Symbol('AI_EMBEDDING_PROVIDER');
