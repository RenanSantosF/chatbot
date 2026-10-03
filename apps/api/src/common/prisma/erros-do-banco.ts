/**
 * O erro que o pooler do Supabase devolve no lugar do original.
 *
 * Pela porta 6543 (modo transação), quando a gravação falha dentro da
 * transação implícita do Prisma, o erro de verdade — quase sempre a
 * duplicidade de duas gravações correndo juntas — chega embrulhado como
 * "Transaction already closed: A rollback cannot be executed…" (P2028).
 * Quem só procura o P2002 deixa esse caso passar como erro 500.
 */
export function transacaoFechada(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) return false;
  const { code, message } = erro as { code?: unknown; message?: unknown };
  return (
    code === 'P2028' ||
    (typeof message === 'string' &&
      message.includes('Transaction already closed'))
  );
}

/** Violação de índice único (P2002), do jeito que o Prisma entrega. */
export function violouUnicidade(erro: unknown): boolean {
  return (
    typeof erro === 'object' &&
    erro !== null &&
    (erro as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Pode ter sido duplicidade: o P2002 direto, ou ele embrulhado pelo pooler.
 *
 * O segundo caso não é certeza — por isso quem chama confere no banco se o
 * registro concorrente existe antes de seguir como se fosse duplicidade.
 */
export function talvezDuplicidade(erro: unknown): boolean {
  return violouUnicidade(erro) || transacaoFechada(erro);
}
