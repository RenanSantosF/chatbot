import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Sem isto, `og:image` e `canonical` sairiam relativos — e o buscador
  // resolve relativo contra o domínio DELE. É a origem da qual todo
  // endereço absoluto desta árvore é montado.
  metadataBase: new URL(SITE_URL),

  title: {
    // A tela diz onde a pessoa está; a marca diz de quem é a tela. Cada
    // página preenche só a primeira parte.
    template: `%s · ${SITE_NAME}`,
    default: "Inteliwa — atendimento no WhatsApp com inteligência artificial",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  generator: undefined,

  // Uma frase de busca por linha, todas coisas que um dono de negócio
  // realmente digita. Não substitui o texto da página — complementa.
  keywords: [
    "atendimento no WhatsApp",
    "chatbot WhatsApp com IA",
    "responder cliente automaticamente",
    "WhatsApp Business API",
    "atendimento automatizado",
    "central de atendimento WhatsApp",
    "múltiplos atendentes no mesmo número",
    "inteligência artificial para atendimento",
  ],

  alternates: { canonical: "/" },

  /**
   * Fallback genérico, de propósito.
   *
   * O Next NÃO mescla `openGraph` campo a campo: quando uma página declara
   * o dela, o objeto inteiro daqui é substituído. Se a chamada da landing
   * ("Seu cliente pergunta às duas da manhã") morasse aqui, ela vazaria
   * pro card de toda página que não sobrescrevesse — e alguém colando o
   * link dos termos no grupo veria a propaganda da home no lugar do
   * documento. Quem tem discurso próprio declara o seu.
   */
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "/",
    siteName: SITE_NAME,
    title: "Inteliwa — atendimento no WhatsApp com inteligência artificial",
    description: SITE_DESCRIPTION,
  },

  twitter: {
    card: "summary_large_image",
    title: "Inteliwa — atendimento no WhatsApp com inteligência artificial",
    description: SITE_DESCRIPTION,
  },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // O Google corta a prévia por conta própria; liberar deixa ele
      // escolher o trecho que responde a busca, que costuma ser melhor
      // que os 160 caracteres padrão.
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },

  category: "technology",
  formatDetection: { telephone: false },
};

/**
 * `themeColor` fora do metadata de propósito: no App Router ele vive no
 * viewport, e deixá-lo no lugar antigo emite aviso no build.
 *
 * Os dois valores existem porque o painel tem tema claro e escuro — sem o
 * par, a barra do navegador no celular fica clara num app escuro.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#161717" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      // O next-themes escreve a classe do tema no <html> antes da hidratação;
      // sem isso o React reclama da diferença com o HTML do servidor.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/*
        `min-h-full`, e NÃO `h-full overflow-hidden`.

        A trava de altura existia por causa do Inbox, onde quem rola são as
        colunas de dentro e a página inteira precisa ficar parada. Mas ela
        estava aqui, no documento — então valia também pra landing, termos,
        privacidade, login e cadastro, que são páginas de LER. No celular o
        efeito era o pior possível: a landing abria, mostrava a primeira
        dobra e não descia. Não era uma rolagem travada, era uma página sem
        rolagem nenhuma — o resto do conteúdo estava sendo cortado fora da
        janela.

        O Inbox não perde nada: quem o prende é o próprio painel
        (`SidebarProvider`, com `h-svh overflow-hidden`), que se ancora na
        altura da janela independentemente do que o documento faça.
      */}
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
