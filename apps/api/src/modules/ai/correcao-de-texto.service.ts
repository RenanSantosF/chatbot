import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { AiCredentialsResolver } from './providers/ai-credentials.resolver';
import {
  AI_PROVIDER,
  type AiProvider,
} from './providers/ai-provider.interface';

/**
 * Quantas correções uma conta pode pedir por mês.
 *
 * Não é limite de uso normal — é trava contra abuso. Uma correção custa
 * cerca de R$ 0,003 (com o raciocínio ligado); três mil no mês somam uns
 * R$ 9, enquanto uma equipe de cinco pessoas usando bastante fica bem
 * abaixo disso.
 */
export const LIMITE_DE_CORRECOES_POR_MES = 3000;

/** Texto mais comprido que isso não é mensagem de WhatsApp, é documento. */
const MAXIMO_DE_CARACTERES = 2000;

/**
 * O que a IA recebe pra corrigir.
 *
 * A primeira versão pedia "sem perder o jeito de quem escreveu", e o
 * modelo leu isso como licença pra manter o erro: "os produtos tava" e
 * "os negócio" passaram intactos, porque soavam como o jeito da pessoa.
 * O pedido de verdade é o contrário — tom simples e simpático, português
 * SEM erro. Por isso a lista é explícita sobre o que é erro (concordância,
 * regência, conjugação) e o que é só tom (frase curta, "a gente"), e os
 * exemplos mostram o nível de exigência.
 */
const INSTRUCOES = `Você é um revisor de português do Brasil. Corrige a mensagem que um atendente vai mandar a um cliente pelo WhatsApp.

Devolva SOMENTE o texto corrigido — sem aspas, sem comentário, sem explicar o que mudou.

O resultado precisa estar 100% correto na norma padrão, com tom natural e simpático de atendimento (nem robótico, nem formal demais). Corrija TODOS os erros, inclusive os que parecem "jeito de falar":
- Ortografia, acentos e letras maiúsculas.
- Pontuação: vírgulas, pontos, e frases longas divididas quando ficarem confusas.
- Concordância verbal: "os produtos tava" → "os produtos estavam"; "a gente fomos" → "a gente foi".
- Concordância nominal: "umas coisa" → "umas coisas"; "os negócio" → "as coisas".
- Conjugação e forma do verbo: "eu foi" → "eu fui"; "fui paga" → "fui pagar"; "se eu ver" → "se eu vir".
- Regência: "fui no mercado" → "fui ao mercado"; "prefiro mais X do que Y" → "prefiro X a Y".
- Troca de palavras parecidas: "mais" (quantidade) × "mas" (oposição); "mal" × "mau"; "há" × "a"; "porque" × "por que".
- Abreviações de internet por extenso: vc → você, q → que, tb → também, pq → porque, blz → beleza.
- Gíria ou palavra vaga que fica errada ou pouco clara pode ser trocada por uma palavra comum que diga a mesma coisa.

O que NUNCA fazer:
- Mudar o sentido, inventar informação, prometer algo, ou acrescentar saudação/despedida que não estava lá.
- Mudar valores, preços, datas, horários, endereços, nomes, números, links ou emojis.
- Trocar o idioma, ou deixar o texto rebuscado ("prezado", "venho por meio desta").

Exemplo
Texto: oi tudo bem? os documento que vc pediu ja chegou aqui, amanha eu te mando eles pq hj o sistema ta fora
Corrigido: Oi, tudo bem? Os documentos que você pediu já chegaram aqui. Amanhã eu te mando, porque hoje o sistema está fora do ar.

Exemplo
Texto: a gente fomos no cliente ontem mais ele não tava, dai deixamos os papel com a secretaria dele
Corrigido: A gente foi ao cliente ontem, mas ele não estava. Aí deixamos os papéis com a secretária dele.

Se o texto já estiver correto, devolva igual.`;

/**
 * "Corrige isso pra mim" — o botão ✨ do compositor.
 *
 * O texto corrigido volta pro campo, e quem atende revisa antes de mandar
 * (e pode desfazer). Nada sai daqui direto pro cliente.
 */
@Injectable()
export class CorrecaoDeTextoService {
  private readonly logger = new Logger(CorrecaoDeTextoService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly credentials: AiCredentialsResolver,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  async corrigir(texto: string, userId: string): Promise<{ texto: string }> {
    const original = texto.trim();
    if (!original)
      throw new BadRequestException('Escreva alguma coisa pra corrigir.');
    if (original.length > MAXIMO_DE_CARACTERES) {
      throw new BadRequestException(
        `Dá pra corrigir até ${MAXIMO_DE_CARACTERES} caracteres de uma vez.`,
      );
    }

    const conta = await this.prisma.db.billingAccount.findFirst({
      select: { id: true, aiCorrecoesNoPeriodo: true },
    });
    if (conta && conta.aiCorrecoesNoPeriodo >= LIMITE_DE_CORRECOES_POR_MES) {
      throw new HttpException(
        'As correções deste mês acabaram. Elas voltam na renovação do plano.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const resolucao = await this.credentials.resolve();
    if (!resolucao.credentials) {
      throw new ServiceUnavailableException(
        'A correção por IA está indisponível agora. Tente de novo em instantes.',
      );
    }

    let corrigido: string;
    let uso: { inputTokens: number; outputTokens: number } | undefined;
    try {
      const resposta = await this.ai.generateReply({
        systemPrompt: INSTRUCOES,
        history: [{ role: 'user', content: original }],
        apiKey: resolucao.credentials.apiKey,
        model: resolucao.credentials.model,
        // Pensar um pouco é o que pega a concordância que escapa numa
        // leitura só; custa uns décimos de centavo a mais por correção.
        raciocinio: 'baixo',
        // Revisão tem uma resposta certa: nada de variar a cada clique.
        temperatura: 0,
        // O raciocínio conta no teto de saída, e o texto pode ter 2.000
        // caracteres — o teto do atendimento (700) cortaria no meio.
        maximoDeSaida: 3000,
      });
      corrigido = limpar(resposta.content);
      uso = resposta.usage;
    } catch (erro) {
      this.logger.warn(
        `A correção de texto falhou: ${erro instanceof Error ? erro.message : erro}`,
      );
      throw new ServiceUnavailableException(
        'Não deu pra corrigir agora. Tente de novo em instantes.',
      );
    }
    // Resposta vazia ou desproporcional não é correção: devolve o original.
    if (!corrigido || corrigido.length > original.length * 3 + 50) {
      corrigido = original;
    }

    await Promise.all([
      conta
        ? this.prisma.db.billingAccount.update({
            where: { id: conta.id },
            data: {
              aiCorrecoesNoPeriodo: { increment: 1 },
              aiInputTokensUsed: { increment: uso?.inputTokens ?? 0 },
              aiOutputTokensUsed: { increment: uso?.outputTokens ?? 0 },
            },
          })
        : null,
      // A dica que ensina o atalho para de aparecer pra quem já usou.
      this.prisma.db.user.updateMany({
        where: { id: userId, usouCorrecaoEm: null },
        data: { usouCorrecaoEm: new Date() },
      }),
    ]);

    return { texto: corrigido };
  }
}

/** Tira aspas e prefixos que o modelo às vezes acrescenta. */
export function limpar(bruto: string): string {
  let texto = bruto.trim();
  texto = texto.replace(/^(aqui est[áa][^:]*:|texto corrigido:)\s*/i, '');
  const aspas = /^["“'](.*)["”']$/s.exec(texto);
  if (aspas) texto = aspas[1].trim();
  return texto;
}
