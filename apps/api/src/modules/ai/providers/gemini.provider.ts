import { Injectable, Logger } from '@nestjs/common';
import type {
  Content,
  GenerateContentParameters,
  GenerateContentResponse,
  ThinkingConfig,
} from '@google/genai';
import { ApiError, GoogleGenAI, ThinkingLevel } from '@google/genai';
import type {
  AiEmbedInput,
  AiEmbeddingProvider,
  AiTranscribeInput,
  AiTranscriptionProvider,
  AiGenerateInput,
  AiGenerateResult,
  AiMessage,
  AiProvider,
} from './ai-provider.interface';
import { MODELO_PADRAO } from '../modelos';

const DEFAULT_MODEL = MODELO_PADRAO;
const EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 768;

/** Limite de idas-e-voltas de ferramenta numa única resposta — evita loop infinito se o modelo insistir em chamar ferramentas. */
const MAX_TOOL_TURNS = 4;

/**
 * Quanto o modelo pode "pensar" antes de escrever: o mínimo possível.
 *
 * Raciocínio é cobrado como saída em TODO turno — inclusive num "bom dia".
 * São tokens que o cliente nunca lê e que, num atendimento, quase não
 * mudam a resposta. A decisão mais delicada (transferir pra um humano)
 * não depende só do modelo: as travas conferem a resposta e escalam por
 * conta própria (ver ai-guardrails.ts).
 *
 * O jeito de pedir "mínimo" mudou entre gerações, e foi isso que quebrou
 * a IA com um 400 INVALID_ARGUMENT seco:
 *
 * - Gemini 2.5 desliga com `thinkingBudget: 0`.
 * - Gemini 3.x NÃO desliga: recusa o `thinkingBudget: 0` (a Flash-Lite
 *   com 400) e pede `thinkingLevel`, cujo menor valor é MINIMAL. Algumas
 *   variantes não aceitam MINIMAL e só vão de LOW pra cima — por isso a
 *   segunda tentativa em `gerarConteudo`.
 * - Antes da 2.5 não há raciocínio nenhum pra configurar.
 *
 * Nome desconhecido (um alias como `gemini-flash-latest`) é tratado como
 * geração atual, que é o que esses aliases apontam.
 */
export function configDeRaciocinio(
  modelo: string,
  nivel: 'minimo' | 'baixo' = 'minimo',
): ThinkingConfig | undefined {
  const versao = /gemini-(\d+)(?:\.(\d+))?/.exec(modelo);
  const maior = versao ? Number(versao[1]) : 3;
  const menor = versao?.[2] ? Number(versao[2]) : 0;

  if (maior >= 3) {
    return {
      thinkingLevel:
        nivel === 'baixo' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
    };
  }
  if (maior === 2 && menor >= 5) return { thinkingBudget: 0 };
  return undefined;
}

/**
 * Modelos que já recusaram MINIMAL nesta execução do servidor.
 *
 * Sem memória, cada resposta pagaria uma chamada recusada antes da que
 * funciona — o dobro da latência pra sempre, por causa de um detalhe de
 * configuração que não muda.
 */
const soAceitamNivelBaixo = new Set<string>();

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
 * Transcrever é mais lento que responder, e vale esperar.
 *
 * O arquivo sobe inline junto do pedido, e um áudio de dois minutos são
 * alguns megabytes atravessando antes de o modelo começar. Quarenta
 * segundos cobre com folga o áudio de recado comum; acima disso, o mais
 * provável é que não vá voltar.
 */
const TEMPO_LIMITE_TRANSCRICAO_MS = 40_000;

/**
 * Traduz o cancelamento por tempo numa frase que diz o que aconteceu.
 *
 * O erro cru de um `AbortSignal` é "This operation was aborted", que no
 * simulador aparece pro dono da empresa como se o sistema tivesse
 * quebrado. Ele não quebrou — o provedor não respondeu.
 */
function comoErroDeTempo(error: unknown, oQue: string): Error {
  /*
   * Recusa do Google vira frase, não JSON.
   *
   * O erro cru do SDK é o corpo da resposta —
   * `{"error":{"code":400,"message":"Request contains an invalid
   * argument."...}}` — e era isso que aparecia no simulador pro dono da
   * empresa. O detalhe técnico continua no log (ver quem chama).
   */
  if (error instanceof ApiError) {
    const porStatus: Record<number, string> = {
      400: 'O provedor de IA recusou o pedido (configuração inválida). Avise o suporte.',
      401: 'A chave da IA da plataforma foi recusada. Avise o suporte.',
      403: 'A chave da IA da plataforma não tem acesso a este modelo. Avise o suporte.',
      404: 'O modelo de IA configurado não existe mais. Avise o suporte.',
      429: 'O provedor de IA está no limite de uso agora. Tente de novo em instantes.',
    };
    const frase =
      porStatus[error.status] ??
      (error.status >= 500
        ? 'O provedor de IA está instável agora. Tente de novo em instantes.'
        : undefined);
    if (frase) return new Error(frase);
  }

  const abortou =
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError');

  return abortou
    ? new Error(
        `O provedor de IA não respondeu em ${TEMPO_LIMITE_MS / 1000} segundos (${oQue}). Tente de novo; se persistir, avise o suporte.`,
      )
    : error instanceof Error
      ? error
      : new Error(String(error));
}

function toGeminiRole(role: AiMessage['role']): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user';
}

/**
 * O consumo interno vira o formato que o resto do sistema entende.
 *
 * Raciocínio soma em cima da saída porque é assim que o Google cobra —
 * ele não tem preço próprio, é billado como token de saída comum. No
 * Gemini 3 ele não zera (o mínimo é MINIMAL), então entra na conta.
 */
function usoAcumulado(consumo: {
  entrada: number;
  saida: number;
  raciocinio: number;
}) {
  return {
    inputTokens: consumo.entrada,
    outputTokens: consumo.saida + consumo.raciocinio,
  };
}

@Injectable()
export class GeminiProvider
  implements AiProvider, AiEmbeddingProvider, AiTranscriptionProvider
{
  private readonly logger = new Logger(GeminiProvider.name);

  /**
   * `generateContent` com o raciocínio no mínimo que o modelo aceita.
   *
   * Tenta MINIMAL; se o modelo recusar com 400, tenta LOW uma vez e
   * lembra disso (ver `soAceitamNivelBaixo`). Um 400 que se repete com LOW
   * é outro problema, e sobe como está.
   */
  private async gerarConteudo(
    client: GoogleGenAI,
    params: GenerateContentParameters,
    minimo: 'minimo' | 'baixo' = 'minimo',
  ): Promise<GenerateContentResponse> {
    const modelo = params.model;
    const comNivel = (nivel: 'minimo' | 'baixo') =>
      client.models.generateContent({
        ...params,
        config: {
          ...params.config,
          thinkingConfig: configDeRaciocinio(modelo, nivel),
        },
      });

    const geracaoAtual = configDeRaciocinio(modelo)?.thinkingLevel;
    // Quem pediu pra pensar mais não passa pelo MINIMAL.
    if (geracaoAtual && minimo === 'baixo') return comNivel('baixo');
    if (!geracaoAtual || soAceitamNivelBaixo.has(modelo)) {
      return comNivel(soAceitamNivelBaixo.has(modelo) ? 'baixo' : 'minimo');
    }

    try {
      return await comNivel('minimo');
    } catch (erro) {
      if (!(erro instanceof ApiError) || erro.status !== 400) throw erro;
      this.logger.warn(
        `${modelo} recusou o raciocínio MINIMAL; tentando LOW. (${erro.message})`,
      );
      const resposta = await comNivel('baixo');
      soAceitamNivelBaixo.add(modelo);
      return resposta;
    }
  }

  async generateReply({
    systemPrompt,
    history,
    apiKey,
    model,
    tools,
    executeTool,
    raciocinio,
    temperatura,
    maximoDeSaida,
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
        const response = await this.gerarConteudo(
          client,
          {
            model: resolvedModel,
            contents,
            config: {
              systemInstruction: systemPrompt,
              tools: geminiTools,
              temperature: temperatura ?? TEMPERATURA,
              maxOutputTokens: maximoDeSaida ?? MAXIMO_DE_SAIDA,
              abortSignal: AbortSignal.timeout(TEMPO_LIMITE_MS),
            },
          },
          raciocinio,
        );

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
              return { content: '', usage: usoAcumulado(consumo) };
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
          return { content: text, usage: usoAcumulado(consumo) };
        }

        if (!executeTool) {
          throw new Error(
            'A IA tentou usar uma ferramenta, mas nenhum executor foi configurado.',
          );
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
                  response: result.error
                    ? { error: result.error }
                    : { output: result.output ?? null },
                },
              },
            ],
          });
        }
      }

      throw new Error(
        'A IA excedeu o limite de chamadas de ferramenta nesta resposta.',
      );
    } catch (error) {
      this.logger.error(
        `Falha ao chamar o Gemini (${resolvedModel})`,
        error instanceof Error ? error.stack : error,
      );
      throw comoErroDeTempo(error, 'gerar a resposta');
    }
  }

  /**
   * O que o cliente falou, em texto.
   *
   * O áudio vai inline em base64 — o mesmo caminho do anexo na Evolution,
   * e pela mesma razão: uma etapa de upload separado seria mais uma coisa
   * pra falhar num fluxo que já roda dentro do processamento do webhook.
   *
   * A instrução é enxuta de propósito. Pedir resumo ou interpretação aqui
   * seria transformar a fala do cliente em opinião do modelo antes de
   * qualquer pessoa ler o original — e é a fala dele que vira prova num
   * atendimento jurídico. O que se quer é estenografia, não redação.
   */
  async transcribe({
    buffer,
    mimeType,
    apiKey,
    model,
  }: AiTranscribeInput): Promise<string | null> {
    const client = new GoogleGenAI({ apiKey });

    try {
      const resposta = await this.gerarConteudo(client, {
        model: model ?? DEFAULT_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'Transcreva este áudio em português do Brasil, palavra por palavra. ' +
                  'Devolva SÓ a transcrição, sem comentários, sem aspas e sem descrever ' +
                  'sons. Se não houver fala audível, responda exatamente: (sem fala)',
              },
              {
                inlineData: {
                  mimeType: mimeType.split(';')[0].trim(),
                  data: buffer.toString('base64'),
                },
              },
            ],
          },
        ],
        config: {
          // Zero: transcrição não é lugar pra variação. A mesma gravação
          // tem que dar o mesmo texto sempre — é o que permite comparar o
          // que o painel mostra com o que o cliente disse.
          temperature: 0,
          abortSignal: AbortSignal.timeout(TEMPO_LIMITE_TRANSCRICAO_MS),
        },
      });

      const texto = resposta.text?.trim();
      if (!texto || texto === '(sem fala)') return null;

      this.logger.log(
        `Áudio transcrito (${buffer.length} bytes): ${texto.length} caracteres.`,
      );
      return texto;
    } catch (error) {
      // Nunca lança: a mensagem já está gravada e aparece no painel de
      // qualquer jeito. Sem transcrição o balão volta a ser só o áudio,
      // que é o comportamento de antes — degradar é aceitável, derrubar o
      // recebimento não.
      this.logger.warn(
        `Não deu pra transcrever o áudio: ${error instanceof Error ? error.message : error}`,
      );
      return null;
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
