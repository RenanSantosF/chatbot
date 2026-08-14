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

/**
 * Quanto o modelo pode "pensar" antes de escrever.
 *
 * O gemini-2.5-flash raciocina por padrão, e esse raciocínio é cobrado
 * como saída em TODO turno — inclusive num "bom dia". São tokens que o
 * cliente nunca lê e que, num atendimento, quase não mudam a resposta:
 * responder o horário de funcionamento a partir de um trecho de documento
 * não é um problema que precise de rascunho.
 *
 * Zero desliga. A escolha é consciente e tem uma rede embaixo: a decisão
 * mais delicada que o modelo toma aqui é quando transferir pra um humano,
 * e essa decisão NÃO depende só dele — as travas conferem a resposta e
 * escalam por conta própria quando ele promete gente e não chama a
 * ferramenta (ver ai-guardrails.ts).
 *
 * Se um dia a operação exigir raciocínio (respostas que dependem de
 * calcular prazo, comparar tabela de preço), é este número que sobe.
 */
const ORCAMENTO_DE_RACIOCINIO = 0;

/**
 * Teto da resposta.
 *
 * É WhatsApp: quatro linhas cabem na tela do celular, e um texto de vinte
 * o cliente não lê. O teto é generoso em relação a isso de propósito —
 * ele não existe pra encurtar a resposta boa (disso cuida a instrução no
 * prompt), e sim pra impedir que um modelo em laço escreva mil linhas e
 * cobre por todas.
 */
const MAXIMO_DE_SAIDA = 700;

/**
 * Baixa, e não zero.
 *
 * Atendimento quer consistência: a mesma pergunta merece a mesma resposta
 * hoje e amanhã, e criatividade aqui é sinônimo de inventar política da
 * empresa. Zero deixaria o texto repetitivo a ponto de soar automático,
 * que é justamente o que a tela toda tenta evitar.
 *
 * Era 0.4, e 0.4 se mostrou caro. Num teste real, perguntaram o horário de
 * atendimento — que estava cadastrado — e a resposta veio com o horário
 * certo mais um preço que ninguém tinha cadastrado. Esse é o custo da
 * margem: quanto mais liberdade pra escolher a próxima palavra, mais o
 * modelo completa o que falta com o que costuma ser verdade em empresas
 * parecidas. Numa conversa de atendimento, a variedade que se ganha não
 * compensa o que se arrisca.
 */
const TEMPERATURA = 0.2;

/**
 * Até quando esperar o Google responder.
 *
 * Não é conforto: a resposta da IA acontece DENTRO do processamento do
 * webhook, então uma chamada pendurada segura a entrega da Meta até ela
 * desistir e reenviar. Vinte e cinco segundos é folgado pra um modelo
 * rápido e curto o bastante pra caber na paciência dela.
 *
 * Sem isto, "a IA travou" não tinha fim: a requisição ficava viva
 * segurando uma conexão, e quem descobria era o cliente, pelo silêncio.
 */
const TEMPO_LIMITE_MS = 25_000;
const TEMPO_LIMITE_EMBEDDING_MS = 15_000;

/**
 * Traduz o cancelamento por tempo numa frase que diz o que aconteceu.
 *
 * O erro cru de um `AbortSignal` é "This operation was aborted", que no
 * simulador aparece pro dono da empresa como se o sistema tivesse
 * quebrado. Ele não quebrou — o provedor não respondeu.
 */
function comoErroDeTempo(error: unknown, oQue: string): Error {
  const abortou =
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError');

  return abortou
    ? new Error(
        `O provedor de IA não respondeu em ${TEMPO_LIMITE_MS / 1000} segundos (${oQue}). Tente de novo; se persistir, confira a chave e o modelo em Configurações > IA.`,
      )
    : error instanceof Error
      ? error
      : new Error(String(error));
}

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

    // Somado ao longo das idas-e-voltas de ferramenta: uma resposta que
    // chama transferToQueue custa duas chamadas ao modelo, e o número que
    // interessa pra conta do fim do mês é o total da resposta, não o de
    // cada pedaço.
    const consumo = { entrada: 0, saida: 0, raciocinio: 0 };
    // Alguma ferramenta já rodou nesta resposta? Muda o que fazer com um
    // texto vazio no fim: sem ferramenta é falha; COM ferramenta o mundo
    // já mudou, e derrubar tudo com uma exceção apagaria a única coisa que
    // ainda dava pra dizer ao cliente (ver o `return` vazio abaixo).
    let usouFerramenta = false;

    try {
      for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
        const response = await client.models.generateContent({
          model: resolvedModel,
          contents,
          config: {
            systemInstruction: systemPrompt,
            tools: geminiTools,
            temperature: TEMPERATURA,
            maxOutputTokens: MAXIMO_DE_SAIDA,
            thinkingConfig: { thinkingBudget: ORCAMENTO_DE_RACIOCINIO },
            abortSignal: AbortSignal.timeout(TEMPO_LIMITE_MS),
          },
        });

        const uso = response.usageMetadata;
        consumo.entrada += uso?.promptTokenCount ?? 0;
        consumo.saida += uso?.candidatesTokenCount ?? 0;
        consumo.raciocinio += uso?.thoughtsTokenCount ?? 0;

        const calls = response.functionCalls;

        if (!calls || calls.length === 0) {
          const text = response.text?.trim();
          if (!text) {
            /*
             * Vazio depois de a ferramenta ter rodado não é falha — é o
             * modelo achando que já fez o que tinha que fazer.
             *
             * Foi exatamente o que aconteceu em produção: perguntaram o
             * endereço, a IA transferiu pro Jurídico corretamente e não
             * escreveu nada. A exceção subia, o motor caía no caminho de
             * "IA indisponível", e o cliente ficava sem UMA palavra — do
             * lado dele, ninguém tinha respondido. A transferência, essa,
             * já estava feita.
             *
             * Devolver vazio deixa a decisão com quem sabe o que foi
             * executado: o motor (ver AiEngineService.generateReply).
             */
            if (usouFerramenta) {
              this.logger.warn(
                `A IA usou ferramenta e não escreveu resposta (${resolvedModel}). ` +
                  'Quem chamou decide o que dizer ao cliente.',
              );
              return { content: '' };
            }
            throw new Error('A IA retornou uma resposta vazia.');
          }
          // O custo real de cada resposta vai pro log. Sem isto, "a conta
          // da IA veio alta" é uma frase sem investigação possível: não dá
          // pra saber se o caro é o prompt (base de conhecimento grande
          // demais), a resposta, ou o raciocínio invisível do modelo.
          this.logger.log(
            `Resposta gerada (${resolvedModel}): ${consumo.entrada} tokens de entrada, ` +
              `${consumo.saida} de saída, ${consumo.raciocinio} de raciocínio.`,
          );
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
          usouFerramenta = true;
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
      throw comoErroDeTempo(error, 'gerar a resposta');
    }
  }

  async embed({ texts, apiKey, taskType }: AiEmbedInput): Promise<number[][]> {
    const client = new GoogleGenAI({ apiKey });

    try {
      const response = await client.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: texts,
        config: {
          taskType,
          outputDimensionality: EMBEDDING_DIMENSIONS,
          abortSignal: AbortSignal.timeout(TEMPO_LIMITE_EMBEDDING_MS),
        },
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
      throw comoErroDeTempo(error, 'consultar a base de conhecimento');
    }
  }
}
