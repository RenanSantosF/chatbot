/**
 * Um cache em memória com validade curta.
 *
 * Pra dado que TODA requisição consulta e que quase nunca muda — quem é o
 * usuário, o que o papel dele pode, a configuração do Inbox. Cada uma
 * dessas era uma ida ao banco antes do trabalho de verdade, em fila, e o
 * banco fica noutra rede: somadas, eram dezenas de milissegundos em cada
 * clique do painel.
 *
 * Validade curta porque é o que limita o estrago de um valor velho, e
 * `esquecer` pra quem muda o dado não precisar esperar nem ela: quem
 * grava apaga a entrada na hora (a API roda num processo só).
 */
export class CacheCurto<T> {
  private readonly itens = new Map<string, { valor: T; expira: number }>();

  constructor(
    private readonly validadeMs: number,
    private readonly maximo = 5000,
  ) {
    todos.add(this);
  }

  get(chave: string): T | undefined {
    const item = this.itens.get(chave);
    if (!item) return undefined;
    if (item.expira <= Date.now()) {
      this.itens.delete(chave);
      return undefined;
    }
    return item.valor;
  }

  set(chave: string, valor: T) {
    // Teto de entradas: sem ele, um cache por usuário cresceria com cada
    // pessoa que já logou desde que o servidor subiu.
    if (this.itens.size >= this.maximo) {
      const [maisAntiga] = this.itens.keys();
      if (maisAntiga !== undefined) this.itens.delete(maisAntiga);
    }
    this.itens.set(chave, { valor, expira: Date.now() + this.validadeMs });
  }

  limpar() {
    this.itens.clear();
  }

  /** Apaga as entradas cuja chave começa com `prefixo` (ou a exata). */
  esquecer(prefixo: string) {
    for (const chave of this.itens.keys()) {
      if (chave.startsWith(prefixo)) this.itens.delete(chave);
    }
  }
}

/** Todos os caches criados — pra os testes começarem do zero. */
const todos = new Set<CacheCurto<unknown>>();

export function limparTodosOsCaches() {
  for (const cache of todos) cache.limpar();
}
