import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * O que o assistente PROPÕE e só acontece depois do clique em "Confirmar".
 *
 * Criar cadastro, distribuir conversa e ensinar a IA mexem no trabalho da
 * equipe inteira: um "passa as do financeiro pra Ana" mal interpretado
 * mandaria vinte clientes pra mesa errada. Então o modelo nunca executa
 * isso direto — ele monta a proposta, a tela mostra o que vai acontecer,
 * e quem executa é o clique, com a permissão conferida de novo.
 */
export type Acao =
  | { tipo: 'ensinar'; titulo: string; texto: string }
  | { tipo: 'respostaRapida'; atalho: string; titulo?: string; texto: string }
  | { tipo: 'etiqueta'; nome: string; cor?: string }
  | {
      tipo: 'setor';
      nome: string;
      descricao?: string;
      participantes: { id: string; nome: string }[];
    }
  | {
      tipo: 'distribuir';
      conversas: string[];
      para:
        | { tipo: 'pessoa'; id: string; nome: string }
        | { tipo: 'setor'; id: string; nome: string };
    };

export interface Proposta {
  token: string;
  titulo: string;
  detalhe?: string;
}

interface Carga {
  /** Empresa e pessoa que viram a proposta — ninguém confirma a de outro. */
  t: string;
  u: string;
  /** Até quando vale (ms). */
  e: number;
  a: Acao;
}

/** Tempo pra confirmar: suficiente pra ler com calma, curto pra não virar pendência esquecida. */
const VALIDADE_MS = 30 * 60 * 1000;

function segredo(): string {
  const valor = process.env.JWT_SECRET;
  if (!valor) throw new Error('JWT_SECRET não configurado.');
  // Derivado, e não o próprio: um token de proposta nunca serve de sessão.
  return createHmac('sha256', valor).update('copilot-propostas').digest('hex');
}

function assinar(corpo: string): string {
  return createHmac('sha256', segredo()).update(corpo).digest('base64url');
}

export function criarToken(
  acao: Acao,
  quem: { tenantId: string; userId: string },
  agora = Date.now(),
): string {
  const carga: Carga = {
    t: quem.tenantId,
    u: quem.userId,
    e: agora + VALIDADE_MS,
    a: acao,
  };
  const corpo = Buffer.from(JSON.stringify(carga)).toString('base64url');
  return `${corpo}.${assinar(corpo)}`;
}

/**
 * Devolve a ação se o token é legítimo, desta pessoa e ainda vale; senão,
 * a frase que explica por que não.
 */
export function lerToken(
  token: string,
  quem: { tenantId: string; userId: string },
  agora = Date.now(),
): { acao: Acao } | { erro: string } {
  const [corpo, assinatura] = token.split('.');
  if (!corpo || !assinatura) return { erro: 'Proposta inválida.' };

  const esperada = Buffer.from(assinar(corpo));
  const recebida = Buffer.from(assinatura);
  if (
    esperada.length !== recebida.length ||
    !timingSafeEqual(esperada, recebida)
  ) {
    return { erro: 'Proposta inválida.' };
  }

  let carga: Carga;
  try {
    carga = JSON.parse(Buffer.from(corpo, 'base64url').toString()) as Carga;
  } catch {
    return { erro: 'Proposta inválida.' };
  }
  if (carga.t !== quem.tenantId || carga.u !== quem.userId) {
    return { erro: 'Esta proposta não é sua.' };
  }
  if (carga.e < agora) {
    return { erro: 'Esta proposta expirou. Peça de novo ao assistente.' };
  }
  return { acao: carga.a };
}

/**
 * Tokens já usados, pra um clique duplo não criar a mesma coisa duas vezes.
 *
 * Em memória: some num reinício, e tudo bem — a proposta expira em meia
 * hora, e o pior caso é um cadastro repetido que a própria tela recusa
 * (atalho duplicado) ou que se apaga num clique.
 */
const usados = new Map<string, number>();

export function marcarComoUsado(token: string, agora = Date.now()): boolean {
  for (const [chave, validade] of usados) {
    if (validade < agora) usados.delete(chave);
  }
  const chave = token.slice(-43);
  if (usados.has(chave)) return false;
  usados.set(chave, agora + VALIDADE_MS);
  return true;
}

/** Nome sem acento e sem caixa, pra "Ana" achar "Ana Paula" e "financeiro" achar "Financeiro". */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Acha UM item pelo nome. Exato primeiro; depois "começa com" e "contém".
 * Mais de um candidato é ambiguidade — quem decide é a pessoa, não o palpite.
 */
export function acharPorNome<T extends { nome: string }>(
  lista: T[],
  procurado: string,
): { achado: T } | { erro: string } {
  const alvo = normalizar(procurado);
  if (!alvo) return { erro: 'Nome vazio.' };

  const exatos = lista.filter((item) => normalizar(item.nome) === alvo);
  if (exatos.length === 1) return { achado: exatos[0] };

  const parecidos = lista.filter((item) => {
    const nome = normalizar(item.nome);
    return (
      nome.startsWith(alvo) ||
      nome.split(/\s+/).includes(alvo) ||
      // "Contém" só com 3 letras ou mais: "a" contém em quase todo nome.
      (alvo.length >= 3 && nome.includes(alvo))
    );
  });
  if (parecidos.length === 1) return { achado: parecidos[0] };
  if (parecidos.length > 1) {
    return {
      erro: `Mais de um encontrado para "${procurado}": ${parecidos
        .map((item) => item.nome)
        .join(', ')}. Pergunte qual.`,
    };
  }
  return {
    erro: `Nenhum encontrado para "${procurado}". Opções: ${
      lista.map((item) => item.nome).join(', ') || 'nenhuma cadastrada'
    }.`,
  };
}
