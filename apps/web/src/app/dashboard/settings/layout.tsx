"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_SECTIONS, podeAbrirSecao } from "@/components/settings/sections";
import { PageHeader } from "@/components/page-header";
import { usePermissions } from "@/lib/use-permissions";
import { cn } from "@/lib/utils";

/**
 * Todas as telas de configuração dividem este casco: cabeçalho fixo e uma
 * navegação lateral própria. É o que faz "Configurações" parecer uma área
 * do sistema, e não seis páginas soltas que por acaso configuram coisas.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const permissoes = usePermissions();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Configurações"
        description="Canal, inteligência, direcionamento e acessos da sua empresa."
      />

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Seções de configuração" className="lg:sticky lg:top-4 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {SETTINGS_SECTIONS.map((section) => {
              const active = pathname === section.href;
              // Enquanto a matriz não chega, nada é desenhado como
              // bloqueado: riscar a lista inteira por um instante a cada
              // visita seria pior que esperar.
              const bloqueada =
                !permissoes.carregando && !podeAbrirSecao(section, permissoes);

              // Bloqueado continua visível, mas não clicável: some da
              // navegação e o atendente não descobre que a área existe —
              // fica pedindo pro dono uma coisa que ele não sabe nomear.
              // Riscado e com cadeado diz "existe, não é pra você".
              if (bloqueada) {
                return (
                  <li key={section.href} className="shrink-0 lg:shrink">
                    <span
                      aria-disabled="true"
                      title="Você não tem acesso a esta seção. Peça ao dono da conta."
                      className="flex cursor-not-allowed items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground/50"
                    >
                      <section.icon className="size-4 shrink-0" />
                      <span className="whitespace-nowrap line-through">{section.label}</span>
                      <Lock className="size-3 shrink-0 lg:ml-auto" />
                    </span>
                  </li>
                );
              }

              return (
                <li key={section.href} className="shrink-0 lg:shrink">
                  <Link
                    href={section.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                      active
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <section.icon className="size-4 shrink-0" />
                    <span className="whitespace-nowrap">{section.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
