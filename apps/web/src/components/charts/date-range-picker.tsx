"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface DateRange {
  from: string;
  to: string;
}

const PRESETS = [
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
] as const;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function rangeForDays(days: number): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86400000);
  return { from: isoDay(from), to: isoDay(to) };
}

/** Atalhos pro caso comum e os dois campos de data pro resto. */
export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-0.5 rounded-lg border bg-background p-0.5">
        {PRESETS.map((preset) => {
          const preset_ = rangeForDays(preset.days);
          const active = value.from === preset_.from && value.to === preset_.to;
          return (
            <button
              key={preset.days}
              type="button"
              onClick={() => onChange(rangeForDays(preset.days))}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <Input
        type="date"
        aria-label="Data inicial"
        className="h-8 w-auto text-xs"
        value={value.from}
        max={value.to}
        onChange={(event) => onChange({ ...value, from: event.target.value })}
      />
      <span className="text-xs text-muted-foreground">até</span>
      <Input
        type="date"
        aria-label="Data final"
        className="h-8 w-auto text-xs"
        value={value.to}
        min={value.from}
        onChange={(event) => onChange({ ...value, to: event.target.value })}
      />
    </div>
  );
}
