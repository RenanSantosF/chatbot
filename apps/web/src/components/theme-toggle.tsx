"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // O tema só é conhecido no cliente (vem do localStorage / preferência do
  // SO), então no servidor não dá pra saber qual botão marcar. Renderizar o
  // grupo vazio até montar evita divergência de hidratação.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-background p-0.5">
      {OPTIONS.map((option) => {
        const active = mounted && theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.label}
            aria-label={`Tema ${option.label.toLowerCase()}`}
            aria-pressed={active}
            onClick={() => setTheme(option.value)}
            className={cn(
              "flex size-6.5 items-center justify-center rounded-md transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <option.icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
