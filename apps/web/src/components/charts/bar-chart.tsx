"use client";

import { ChartTable } from "./chart-table";

export interface BarDatum {
  label: string;
  value: number;
}

/**
 * Barras horizontais pra comparar magnitude entre categorias sem ordem
 * natural (status de conversa). Todas na mesma cor de propósito: pintar
 * cada barra de um tom diferente duplicaria o comprimento como matiz e
 * gastaria o canal de cor com informação que a barra já dá.
 */
export function BarChart({ data, valueLabel }: { data: BarDatum[]; valueLabel: string }) {
  const max = Math.max(1, ...data.map((item) => item.value));

  return (
    <div className="viz flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        {data.map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-xs text-muted-foreground" title={item.label}>
              {item.label}
            </span>
            <div className="h-4 flex-1 overflow-hidden rounded-sm bg-muted">
              <div
                className="h-full rounded-r-sm transition-[width] duration-500 ease-out"
                style={{
                  width: `${Math.max((item.value / max) * 100, item.value > 0 ? 2 : 0)}%`,
                  backgroundColor: "var(--viz-series-1)",
                }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums">{item.value}</span>
          </div>
        ))}
      </div>

      <ChartTable
        caption={valueLabel}
        columns={["Categoria", valueLabel]}
        rows={data.map((item) => [item.label, String(item.value)])}
      />
    </div>
  );
}
