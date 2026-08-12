/**
 * Versão em tabela do mesmo dado do gráfico. Fica recolhida, mas existe
 * sempre: é o caminho de leitura pra quem usa leitor de tela e a saída
 * quando a cor não é confiável (daltonismo, impressão, alto contraste).
 */
export function ChartTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <details className="group">
      <summary className="w-fit cursor-pointer list-none text-xs text-muted-foreground underline-offset-4 hover:underline">
        Ver dados em tabela
      </summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-lg border">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" className="px-3 py-2 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.join("|")}>
                {row.map((cell, index) => (
                  <td key={index} className="px-3 py-1.5 tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
