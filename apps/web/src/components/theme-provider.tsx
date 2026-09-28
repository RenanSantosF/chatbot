"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * `attribute="class"` porque o design system usa o variant `dark` do
 * Tailwind (`.dark *` em globals.css) — o next-themes só precisa pendurar
 * a classe no <html>. O padrão é seguir o tema do sistema operacional:
 * quem quiser fixar troca no botão do cabeçalho e a escolha fica salva.
 *
 * O tema é escolha de quem USA o painel, e vale só lá dentro. A landing,
 * o login, o cadastro e as páginas legais são sempre claros: são a vitrine
 * do produto, desenhadas pra um fundo só — e quem escolheu o escuro no
 * painel fazia a página de apresentação abrir escura pra si mesmo, com
 * fotos e cores que não foram pensadas pra isso.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const dentroDoPainel = pathname?.startsWith("/dashboard") ?? false;

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      forcedTheme={dentroDoPainel ? undefined : "light"}
    >
      {children}
    </NextThemesProvider>
  );
}
