"use client";

import { useState } from "react";
import { useMeasuredWidth } from "./use-measured-width";
import { ChartTable } from "./chart-table";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  points: number[];
}

const HEIGHT = 220;
const PADDING = { top: 16, right: 16, bottom: 26, left: 40 };

/** Escala de topo "redonda", pra os rótulos do eixo caírem em números limpos. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function LineChart({
  labels,
  series,
  valueLabel,
}: {
  labels: string[];
  series: LineSeries[];
  valueLabel: string;
}) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 10);
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.points)));
  const stepX = labels.length > 1 ? plotWidth / (labels.length - 1) : 0;

  const x = (index: number) => PADDING.left + index * stepX;
  const y = (value: number) => PADDING.top + plotHeight - (value / max) * plotHeight;

  const ticks = [0, max / 2, max];

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - bounds.left - PADDING.left;
    if (stepX === 0) {
      setHoverIndex(0);
      return;
    }
    const index = Math.round(offset / stepX);
    setHoverIndex(Math.min(Math.max(index, 0), labels.length - 1));
  }

  return (
    <div className="viz flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((item) => (
          <span key={item.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="h-0.5 w-3.5 rounded-full"
              style={{ backgroundColor: item.color }}
              aria-hidden
            />
            {item.label}
          </span>
        ))}
      </div>

      <div ref={ref} className="relative w-full">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${valueLabel} por dia`}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PADDING.left}
                x2={PADDING.left + plotWidth}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--viz-grid)"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 8}
                y={y(tick) + 3.5}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {Math.round(tick)}
              </text>
            </g>
          ))}

          {hoverIndex !== null ? (
            <line
              x1={x(hoverIndex)}
              x2={x(hoverIndex)}
              y1={PADDING.top}
              y2={PADDING.top + plotHeight}
              stroke="var(--viz-grid)"
              strokeWidth={1}
            />
          ) : null}

          {series.map((item) => (
            <polyline
              key={item.key}
              fill="none"
              stroke={item.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={item.points.map((value, index) => `${x(index)},${y(value)}`).join(" ")}
            />
          ))}

          {hoverIndex !== null
            ? series.map((item) => (
                <circle
                  key={item.key}
                  cx={x(hoverIndex)}
                  cy={y(item.points[hoverIndex] ?? 0)}
                  r={4}
                  fill={item.color}
                  stroke="var(--viz-surface)"
                  strokeWidth={2}
                />
              ))
            : null}

          {labels.map((label, index) =>
            // Só as pontas e o meio recebem rótulo: com 30 dias, um por
            // ponto vira uma tarja preta ilegível.
            index === 0 || index === labels.length - 1 || index === Math.floor(labels.length / 2) ? (
              <text
                key={label}
                x={x(index)}
                y={HEIGHT - 8}
                textAnchor={index === 0 ? "start" : index === labels.length - 1 ? "end" : "middle"}
                className="fill-muted-foreground text-[10px]"
              >
                {label}
              </text>
            ) : null,
          )}
        </svg>

        {hoverIndex !== null ? (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{
              left: Math.min(Math.max(x(hoverIndex) - 60, 0), Math.max(width - 130, 0)),
            }}
          >
            <p className="mb-1 font-medium">{labels[hoverIndex]}</p>
            {series.map((item) => (
              <p key={item.key} className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: item.color }}
                  aria-hidden
                />
                {item.label}: <span className="font-medium text-foreground">{item.points[hoverIndex]}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <ChartTable
        caption={`${valueLabel} por dia`}
        columns={["Dia", ...series.map((item) => item.label)]}
        rows={labels.map((label, index) => [label, ...series.map((item) => String(item.points[index] ?? 0))])}
      />
    </div>
  );
}
