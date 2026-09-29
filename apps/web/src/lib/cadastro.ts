/**
 * As regras do cadastro, fora da tela: o que conta como resposta válida
 * em cada passo e como a senha é medida.
 *
 * As mesmas do servidor (ver RegisterDto na API) — a tela só avisa antes,
 * pra ninguém chegar no último passo e descobrir que o primeiro estava
 * errado.
 */

export const MINIMO_DA_SENHA = 8;

/** "Renan Santos Ferreira" → "Renan". Pra falar com a pessoa pelo nome. */
export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

/** Iniciais pro avatar da prévia: "Clínica Sorriso" → "CS". */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";
  const [primeira, segunda] = [partes[0], partes[partes.length - 1]];
  return (partes.length === 1 ? primeira.slice(0, 2) : primeira[0] + segunda[0]).toUpperCase();
}

export function erroDoNome(nome: string): string | null {
  const limpo = nome.trim();
  if (limpo.length < 2) return "Conta pra gente como podemos te chamar.";
  if (limpo.length > 120) return "Esse nome ficou longo demais.";
  return null;
}

export function erroDaEmpresa(nome: string): string | null {
  const limpo = nome.trim();
  if (limpo.length < 2) return "Qual o nome da sua empresa?";
  if (limpo.length > 120) return "Esse nome ficou longo demais.";
  return null;
}

export function erroDoEmail(email: string): string | null {
  const limpo = email.trim();
  if (!limpo) return "Digite o e-mail que você vai usar pra entrar.";
  // A mesma forma que o navegador aceita num input de e-mail: algo@algo.algo.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpo)) return "Esse e-mail não parece completo.";
  return null;
}

export function erroDaSenha(senha: string): string | null {
  if (senha.length < MINIMO_DA_SENHA) return `A senha precisa de pelo menos ${MINIMO_DA_SENHA} caracteres.`;
  if (senha.length > 72) return "A senha pode ter no máximo 72 caracteres.";
  return null;
}

export interface ForcaDaSenha {
  /** 0 (vazia) a 3 (forte). */
  nivel: 0 | 1 | 2 | 3;
  rotulo: string;
  requisitos: { texto: string; ok: boolean }[];
}

/**
 * Quão boa é a senha, em três degraus.
 *
 * Só o tamanho é exigido (é o que o servidor cobra); o resto é conselho —
 * barrar "Senha123" por falta de símbolo irrita mais do que protege.
 */
export function forcaDaSenha(senha: string): ForcaDaSenha {
  const requisitos = [
    { texto: `${MINIMO_DA_SENHA} caracteres ou mais`, ok: senha.length >= MINIMO_DA_SENHA },
    { texto: "Letras e números", ok: /[a-zA-Z]/.test(senha) && /\d/.test(senha) },
    {
      texto: "Maiúscula, símbolo ou 12+ caracteres",
      ok: /[A-Z]/.test(senha) || /[^a-zA-Z0-9]/.test(senha) || senha.length >= 12,
    },
  ];
  if (!senha) return { nivel: 0, rotulo: "", requisitos };
  const cumpridos = requisitos.filter((r) => r.ok).length;
  if (!requisitos[0].ok || cumpridos === 1) return { nivel: 1, rotulo: "Fraca", requisitos };
  if (cumpridos === 2) return { nivel: 2, rotulo: "Boa", requisitos };
  return { nivel: 3, rotulo: "Forte", requisitos };
}
