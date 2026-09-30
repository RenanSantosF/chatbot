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
 * cerca de R$ 0,001; três mil no mês somam uns R$ 3, enquanto uma equipe
 * de cinco pessoas usando bastante fica bem abaixo disso.
 */
export const LIMITE_DE_CORRECOES_POR_MES = 3000;

/** Texto mais comprido que isso não é mensagem de WhatsApp, é documento. */
const MAXIMO_DE_CARACTERES = 2000;

const INSTRUCOES = `Você corrige mensagens que um atendente vai mandar para um cliente pelo WhatsApp.

Devolva SOMENTE o texto corrigido — sem aspas, sem explicação, sem "Aqui está".

O que fazer:
- Corrigir ortografia, acentuação, pontuação, concordância e letras maiúsculas.
- Deixar a frase mais clara e bem escrita, sem perder o jeito de quem escreveu: mensagem informal continua informal, curta continua curta.

O que NUNCA fazer:
- Inventar informação, prometer algo, ou acrescentar saudação/despedida que não estava lá.
- Mudar valores, preços, datas, horários, endereços, nomes, números, links ou emojis.
- Trocar o idioma.

Se o texto já estiver bom, devolva igual.`;

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
        'As correções deste mês acabaram. Elas voltam no dia 1º.',
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
