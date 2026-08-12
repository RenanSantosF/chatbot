"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  /** Quantidade mostrada entre parênteses — some quando indefinida. */
  count?: number;
}

/**
 * Select nativo com aparência do design system. Nativo de propósito: em
 * telas pequenas o seletor do próprio sistema operacional é melhor que
 * qualquer dropdown customizado, e a contagem cabe no texto da opção.
 */
export function SelectField({
  label,
  title,
  value,
  options,
  onChange,
  className,
}: {
  /** Some quando não informado — a própria opção já diz o que é. */
  label?: string;
  /** Nome do filtro pra leitor de tela e dica do mouse, quando não há rótulo visível. */
  title?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      {label ? (
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      ) : null}
      <div className="relative">
        <select
          title={title}
          aria-label={title ?? label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-full appearance-none truncate rounded-md border border-input bg-background py-0 pr-7 pl-2.5 text-xs font-medium shadow-xs outline-none transition-colors hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.count === undefined ? option.label : `${option.label} (${option.count})`}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      </div>
    </label>
  );
}
