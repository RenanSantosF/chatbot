import { Logger } from '@nestjs/common';
import type { PrismaClient } from '../../../generated/prisma/client';

const logger = new Logger('ApagarEmLotes');

/**
 * Quantas linhas saem por vez.
 *
 * O banco derruba uma instrução que passa do tempo limite dele
 * (`statement_timeout`), e apagar uma tabela grande de uma vez é a maior
 * instrução que este sistema chega a emitir — a de mensagens sozinha pode
 * ter uma linha por mensagem já trocada em anos de atendimento. Foi assim
 * que a primeira tentativa de apagar uma conta inteira morreu —
 * `57014: canceling statement due to statement timeout` — com a operação
 * pela metade e ninguém entendendo por quê.
 *
 * Cinco mil é grande o bastante pra terminar rápido e pequeno o bastante
 * pra caber com folga em qualquer limite de tempo configurado.
 */
const LOTE = 5000;

/**
 * Teto de segurança do laço.
 *
 * Se um lote parar de reduzir a tabela (gatilho, permissão, defeito), o
 * laço rodaria pra sempre segurando a requisição. Cem mil voltas cobrem
 * meio bilhão de linhas — muito além do plausível — e ainda assim o laço
 * tem fim.
 */
const MAXIMO_DE_LOTES = 100_000;

/**
 * O lote que morreu de impasse é refeito, não perdido.
 *
 * Impasse (`40P01`) é o banco escolhendo uma vítima entre duas transações
 * que se cruzaram: nada ficou inconsistente, e a instrução simplesmente
 * não aconteceu. Refazer é o tratamento normal, e aqui é o que separa
 * "a operação não terminou" de "um lote demorou um pouco mais".
 *
 * Três tentativas com espera crescente. O que não for impasse sobe na
 * hora — engolir erro de banco aqui esconderia uma exclusão pela metade.
 */
async function comRetentativa(
  operacao: () => Promise<number>,
): Promise<number> {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await operacao();
    } catch (erro) {
      const impasse = /deadlock|40P01/i.test(
        erro instanceof Error ? erro.message : String(erro),
      );
      if (!impasse || tentativa >= 3) throw erro;

      logger.warn(
        `Impasse no banco ao apagar (tentativa ${tentativa}); refazendo o lote.`,
      );
      await new Promise((pronto) => setTimeout(pronto, 250 * tentativa));
    }
  }
}

/**
 * Apaga, em lotes, todas as linhas de um tenant nas tabelas informadas.
 *
 * Compartilhado entre "apagar a conta inteira" (AccountService) e "apagar
 * só o histórico de conversas" (troca de número do WhatsApp, ver
 * EvolutionService) — os dois precisam da mesma cautela: nome de tabela
 * não pode ir como parâmetro em SQL nenhum banco aceita, então ele vem de
 * uma lista fixa escrita em cada chamador, nunca de entrada externa; só o
 * `tenantId` é parametrizado. O `ORDER BY "id"` faz duas exclusões
 * concorrentes pegarem as travas na MESMA ordem — sem isso elas se cruzam
 * e o banco mata uma das duas por impasse.
 *
 * `soltarCitacoesDeMensagem` solta `messages.replyToId` antes de apagar
 * mensagens: uma mensagem pode citar outra da mesma tabela, e embora o
 * `ON DELETE SET NULL` da coluna cuide da consistência sozinho, zerá-la
 * antes evita que o DELETE dispare aquela atualização linha a linha no
 * meio do lote — menos trabalho, e menos chance do impasse acima.
 */
export async function apagarEmLotes(
  client: PrismaClient,
  tenantId: string,
  tabelas: readonly string[],
  {
    soltarCitacoesDeMensagem = false,
  }: { soltarCitacoesDeMensagem?: boolean } = {},
): Promise<number> {
  let total = 0;

  if (soltarCitacoesDeMensagem) {
    for (let volta = 0; volta < MAXIMO_DE_LOTES; volta += 1) {
      const soltas = await comRetentativa(
        () =>
          client.$executeRaw`
          UPDATE "messages" SET "replyToId" = NULL
          WHERE "id" IN (
            SELECT "id" FROM "messages"
            WHERE "tenantId" = ${tenantId} AND "replyToId" IS NOT NULL
            ORDER BY "id"
            LIMIT ${LOTE}
          )`,
      );
      if (soltas < LOTE) break;
    }
  }

  for (const tabela of tabelas) {
    for (let volta = 0; volta < MAXIMO_DE_LOTES; volta += 1) {
      const apagadas = await comRetentativa(() =>
        client.$executeRawUnsafe(
          `DELETE FROM "${tabela}" WHERE "id" IN (
             SELECT "id" FROM "${tabela}"
             WHERE "tenantId" = $1
             ORDER BY "id"
             LIMIT ${LOTE}
           )`,
          tenantId,
        ),
      );
      total += apagadas;
      if (apagadas < LOTE) break;
    }
  }

  return total;
}
