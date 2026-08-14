/**
 * A trava contra fato inventado.
 *
 * O caso que deu origem a isto: perguntaram o endereço do escritório, a
 * base de conhecimento não tinha essa informação, e a IA respondeu
 * "Avenida Paulista, nº 1000, Bela Vista — São Paulo/SP". O escritório
 * fica em Vitória. Nada no prompt tinha sido violado de forma detectável:
 * a resposta era educada, coerente e completamente falsa.
 *
 * O prompt já mandava não inventar. Não adiantou, e não é surpresa — a
 * mesma lição das outras travas (ver ai-guardrails): pedir ao modelo que
 * se contenha é um pedido, não uma garantia. O que dá garantia é conferir
 * depois, com uma regra que não depende da boa vontade dele.
 *
 * A ideia aqui é estreita de propósito. Não se tenta julgar se a resposta
 * é "verdadeira" — isso exigiria saber a verdade. Verifica-se outra coisa,
 * que é decidível: a resposta afirma um dado CONCRETO (endereço, valor,
 * telefone, e-mail, CNPJ, CEP) que não aparece em lugar nenhum do material
 * que nós mesmos entregamos ao modelo? Se não aparece, ele não leu — ele
 * produziu. E um dado desses, errado, chega ao cliente como fato da
 * empresa.
 *
 * Fora do escopo, de propósito: horário, prazo e política. São afirmações
 * igualmente arriscadas, mas escritas de dezenas de formas ("das 8 às
 * 17h", "8h-17h", "comercial"), e uma regra literal ali produziria mais
 * alarme falso que acerto. Essas continuam por conta do prompt e da base.
 */

/** Reduz a uma forma comparável: sem acento, sem caixa, sem pontuação. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

interface Padrao {
  tipo: string;
  regex: RegExp;
  /**
   * O que precisa ser encontrado nas fontes. Quando o trecho casado traz
   * enfeite em volta ("Avenida Paulista, nº 1000, Bela Vista"), procurar
   * a frase inteira daria alarme por diferença de escrita — então procura-se
   * só o miolo que identifica o dado (aqui, o nome da via).
   */
  nucleo?: (casado: RegExpMatchArray) => string;
}

const PADROES: Padrao[] = [
  {
    tipo: 'endereço',
    // Para no primeiro separador: o nome da via basta pra saber se a
    // empresa fica lá. Número e bairro variam de escrita e só atrapalham.
    regex:
      /\b(?:rua|avenida|av\.|alameda|travessa|rodovia|estrada|praça|praca)\s+([^,.\n;(]{2,40})/gi,
    nucleo: (casado) => casado[1],
  },
  { tipo: 'CEP', regex: /\b\d{5}-?\d{3}\b/g },
  { tipo: 'valor', regex: /r\$\s?\d[\d.,]*/gi },
  {
    tipo: 'telefone',
    regex: /\(?\b\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}\b/g,
  },
  { tipo: 'e-mail', regex: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { tipo: 'CNPJ', regex: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g },
];

export interface FatoSemLastro {
  /** Que espécie de dado é — entra na nota que o atendente lê. */
  tipo: string;
  /** O pedaço exato que a IA afirmou, pra conferência humana. */
  trecho: string;
}

/**
 * Dados concretos afirmados na resposta que não existem nas fontes.
 *
 * @param resposta  o texto que iria pro cliente
 * @param fontes    tudo que o modelo recebeu: prompt (instruções da
 *                  empresa, memória do cliente, trechos da base) mais o
 *                  histórico da conversa. O histórico entra porque um dado
 *                  que o PRÓPRIO cliente escreveu e a IA repete de volta
 *                  não é invenção — é confirmação, e é o que se espera.
 */
export function fatosSemLastro(
  resposta: string,
  fontes: string,
): FatoSemLastro[] {
  const referencia = normalizar(fontes);
  const achados: FatoSemLastro[] = [];
  const jaVistos = new Set<string>();

  for (const padrao of PADROES) {
    for (const casado of resposta.matchAll(padrao.regex)) {
      const trecho = casado[0].trim();
      const alvo = normalizar(
        padrao.nucleo ? padrao.nucleo(casado) : casado[0],
      );
      // Miolo curto demais não identifica nada ("Rua 2") e casaria com
      // qualquer fonte por acaso.
      if (alvo.length < 3) continue;
      if (referencia.includes(alvo)) continue;
      if (jaVistos.has(alvo)) continue;

      jaVistos.add(alvo);
      achados.push({ tipo: padrao.tipo, trecho });
    }
  }

  return achados;
}

/**
 * Corta só a frase que inventou, preservando o resto da resposta.
 *
 * A primeira versão desta trava jogava a resposta inteira fora. Na prática
 * ficou assim: o cliente perguntou o horário de atendimento — que ESTÁ
 * cadastrado —, a IA respondeu o horário certo e emendou um preço que
 * ninguém cadastrou. A resposta inteira foi barrada, e a pessoa recebeu
 * "vou confirmar com a equipe" para uma pergunta que o sistema sabia
 * responder. Barrar demais quebra o atendimento tão bem quanto responder
 * errado.
 *
 * Frase é a unidade certa do corte: um dado concreto vive dentro de uma,
 * e as vizinhas seguem de pé sem ela. Não é perfeito — dá pra sobrar um
 * "Além disso," órfão —, e por isso o que sobra ainda passa por um piso de
 * tamanho antes de valer como resposta.
 */
export function podarFatosSemLastro(
  resposta: string,
  fontes: string,
): { texto: string; removidos: FatoSemLastro[] } {
  const removidos = fatosSemLastro(resposta, fontes);
  if (removidos.length === 0) return { texto: resposta, removidos };

  const suspeitos = new Set(removidos.map((fato) => fato.trecho));
  const mantidas = partirEmFrases(resposta).filter(
    (frase) => ![...suspeitos].some((trecho) => frase.includes(trecho)),
  );

  // Sobrou pouca coisa demais pra valer como resposta ("Claro!", "Olá.").
  // Aí é melhor não mandar nada e deixar a frase de encaminhamento falar.
  const texto = mantidas.join(' ').replace(/\s+/g, ' ').trim();
  return { texto: texto.length >= 25 ? texto : '', removidos };
}

/**
 * Quebra em frases sem perder pontuação.
 *
 * Quebra também em linha nova: a IA escreve em parágrafos curtos de
 * WhatsApp, e um parágrafo sem ponto final é uma frase do mesmo jeito.
 */
function partirEmFrases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?])\s+|\n+/)
    .map((parte) => parte.trim())
    .filter(Boolean);
}
