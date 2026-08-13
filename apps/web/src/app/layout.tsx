import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
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
  title: "Clara",
  description: "Atendimento com IA para o seu negócio",
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
      {/* h-full + overflow-hidden, não min-h-full: quem rola é o <main>
          de cada tela. Com a página inteira podendo crescer, o Inbox
          empurrava o compositor pra fora da janela quando a conversa
          ficava longa. */}
      <body className="flex h-full flex-col overflow-hidden">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
