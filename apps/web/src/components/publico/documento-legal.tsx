/**
 * Peças de texto jurídico.
 *
 * Existem pra que Termos e Privacidade não repitam classe de Tailwind em
 * cada parágrafo — e, mais importante, pra que as duas páginas leiam com a
 * mesma voz. Documento legal em que cada seção parece escrita por uma
 * pessoa diferente perde a única coisa que ele precisa ter: credibilidade.
 */

export function DocumentoLegal({
  titulo,
  atualizadoEm,
  resumo,
  children,
}: {
  titulo: string;
  /** Data por extenso. Documento legal sem data não vale como versão. */
  atualizadoEm: string;
  /** O documento em uma frase, antes do texto longo. */
  resumo: string;
  children: React.ReactNode;
}) {
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Atualizado em {atualizadoEm}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">{titulo}</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground text-pretty">
          {resumo}
        </p>
      </header>

      <div className="flex flex-col gap-8">{children}</div>
    </article>
  );
}

export function Secao({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{titulo}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

export function Lista({ itens }: { itens: React.ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-2 pl-1">
      {itens.map((item, indice) => (
        <li key={indice} className="flex gap-2.5">
          <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Bloco de destaque pro que costuma pegar as pessoas de surpresa — custo
 * que chega por fora, prazo que apaga arquivo. Enterrar isso no meio do
 * texto corrido é o que faz alguém dizer "ninguém me avisou".
 */
export function Atencao({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border-l-2 border-primary bg-muted/60 px-4 py-3 text-[15px] leading-relaxed text-pretty">
      {children}
    </p>
  );
}
