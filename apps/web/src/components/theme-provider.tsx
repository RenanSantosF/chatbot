"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * `attribute="class"` porque o design system usa o variant `dark` do
 * Tailwind (`.dark *` em globals.css) — o next-themes só precisa pendurar
 * a classe no <html>. O padrão é seguir o tema do sistema operacional:
 * quem quiser fixar troca no botão do cabeçalho e a escolha fica salva.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
