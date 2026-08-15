import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

/**
 * Casco das páginas que existem sem login: termos, privacidade e o que mais
 * precisar ser lido de fora.
 *
 * Não passa por `apiFetchServer('/auth/me')` de propósito, diferente do
 * casco de autenticação. A Meta abre estes endereços durante a análise do
 * app, e um revisor que caísse numa página exigindo sessão registraria a
 * URL como quebrada.
 */
export default function PublicoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            {SITE_NAME}
          </Link>
          <nav className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link href="/termos" className="transition-colors hover:text-foreground">
              Termos
            </Link>
            <Link href="/privacidade" className="transition-colors hover:text-foreground">
              Privacidade
            </Link>
            <Link
              href="/exclusao-de-dados"
              className="transition-colors hover:text-foreground"
            >
              Excluir dados
            </Link>
          </nav>
        </div>
      </header>

      {/* max-w-3xl e não max-w-5xl: isto é texto pra ler, e linha longa
          demais cansa. A medida fica perto dos 70 caracteres. */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12">{children}</main>

      <footer className="border-t">
        <div className="mx-auto max-w-3xl px-5 py-6 text-xs text-muted-foreground">
          {SITE_NAME} — atendimento por WhatsApp com inteligência artificial.
        </div>
      </footer>
    </div>
  );
}
