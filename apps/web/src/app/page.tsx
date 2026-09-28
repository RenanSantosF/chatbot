import {
  Archive,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  LayoutGrid,
  Route,
  Users,
  Zap,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Marca } from "@/components/marca";
import { redirect } from "next/navigation";
import { ConversaDemo } from "@/components/publico/conversa-demo";
import { apiFetchServer } from "@/lib/api-server";
import { SITE_DESCRIPTION, SITE_NAME, absoluto } from "@/lib/site";
import type { MeResponse } from "@/lib/types";

/*
 * A landing diz pouco, e diz de longe.
 *
 * A versão anterior explicava tudo — cada recurso com um parágrafo, cada
 * passo com três linhas —, e quem chega numa página de produto não lê:
 * passa o olho. Aqui cada bloco é um título curto que se entende sem o
 * resto, e o detalhe fica nas perguntas frequentes, recolhidas, pra quem
 * quiser abrir. O modelo é o de quem vende atendimento pra pequena
 * empresa: título grande, um botão, três garantias e a tela do produto.
 */

/** Cada recurso numa frase que o dono do negócio reconhece como dor. */
const RECURSOS = [
  { icone: Bot, titulo: "Responde sozinha, 24 horas por dia" },
  { icone: Route, titulo: "Passa pra equipe na hora certa" },
  { icone: Users, titulo: "Vários atendentes no mesmo número" },
  { icone: LayoutGrid, titulo: "Filas por setor, sem confusão" },
  { icone: Zap, titulo: "Respostas rápidas e padronizadas" },
  { icone: Archive, titulo: "Histórico e anexos que não somem" },
];

const GARANTIAS = ["Sem trocar de número", "IA já inclusa", "Sem fidelidade"];

const PASSOS = [
  { titulo: "Conecte", texto: "Leia o QR code com o celular que já atende." },
  { titulo: "Ensine", texto: "Escreva o que a IA precisa saber sobre você." },
  { titulo: "Atenda", texto: "A IA cuida do repetitivo; sua equipe, do resto." },
];

/**
 * O que o plano único inclui.
 *
 * O preço é texto solto, não vem de constante do sistema — quem cobra de
 * verdade é o Checkout do Stripe (`STRIPE_PRICE_ID`). Se o valor lá mudar,
 * este texto muda à mão; o limite de respostas vem do AiUsageService.
 */
const PLANO_INCLUI = [
  "3.000 respostas de IA por mês",
  "Atendentes e setores à vontade",
  "Conexão por QR code, no seu número",
  "Etiquetas, filas e respostas rápidas",
  "Sem taxa de instalação",
];

/**
 * As objeções reais de quem chega, respondidas curto.
 *
 * Também alimentam o bloco de perguntas frequentes do Google (ver o
 * JSON-LD), que ocupa mais espaço no resultado de busca que um link comum.
 */
const PERGUNTAS = [
  {
    pergunta: "Preciso trocar o número da empresa?",
    resposta:
      "Não. Você conecta o número que já usa por QR code, como no WhatsApp Web, e as conversas do aparelho vêm junto. Por não ser o caminho oficial da Meta, o número pode desconectar e pedir o QR code de novo.",
  },
  {
    pergunta: "Quanto custa?",
    resposta:
      "R$ 197 por mês, com 3.000 respostas de IA inclusas, sem taxa de instalação e sem fidelidade. Precisou de mais no meio do mês? Compra um pacote extra na hora.",
  },
  {
    pergunta: "E se a IA não souber responder?",
    resposta:
      "Ela passa a conversa pra uma pessoa da equipe, com o motivo escrito. E se ela prometer um retorno e não transferir, o sistema transfere mesmo assim.",
  },
  {
    pergunta: "Os anexos somem depois de 30 dias?",
    resposta:
      "Não. O WhatsApp apaga a mídia depois de 30 dias; a Inteliwa guarda uma cópia própria, que continua abrindo no ano que vem.",
  },
];

/**
 * A landing fala pelo problema, não pela categoria.
 *
 * O `title` foge do padrão "Inteliwa · Inteliwa" do template porque a home é a
 * única página em que o nome do produto sozinho não diz nada a quem nunca
 * ouviu falar dele — a promessa precisa caber no próprio resultado de
 * busca.
 */
export const metadata: Metadata = {
  title: {
    absolute: "Inteliwa — atendimento no WhatsApp com IA para a sua empresa",
  },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "/",
    siteName: SITE_NAME,
    title: "Seu WhatsApp atendendo sozinho, 24 horas.",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Seu WhatsApp atendendo sozinho, 24 horas.",
    description: SITE_DESCRIPTION,
  },
};

export default async function Home() {
  const session = await apiFetchServer<MeResponse>("/auth/me");
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      {/*
        O que a página é, dito numa linguagem que o buscador entende.
        O texto visível continua sendo a fonte da verdade — isto só o
        organiza, e é o que permite o Google montar o bloco de perguntas
        frequentes em vez de um link solto.

        Vai num <script type="application/ld+json">, que o React não
        executa nem interpreta: por isso `dangerouslySetInnerHTML` aqui é
        o caminho normal, e o conteúdo é serializado de constantes nossas,
        nunca de entrada de usuário.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "SoftwareApplication",
                name: SITE_NAME,
                applicationCategory: "BusinessApplication",
                operatingSystem: "Web",
                url: absoluto("/"),
                description: SITE_DESCRIPTION,
                inLanguage: "pt-BR",
                featureList: RECURSOS.map((r) => r.titulo),
              },
              {
                "@type": "FAQPage",
                mainEntity: PERGUNTAS.map((item) => ({
                  "@type": "Question",
                  name: item.pergunta,
                  acceptedAnswer: { "@type": "Answer", text: item.resposta },
                })),
              },
            ],
          }),
        }}
      />

      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <Link href="/" className="flex items-center gap-2">
            <Marca className="size-8" />
            <span className="text-lg font-semibold tracking-tight">{SITE_NAME}</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
            <Link href="#recursos" className="transition-colors hover:text-primary">
              Recursos
            </Link>
            <Link href="#precos" className="transition-colors hover:text-primary">
              Preço
            </Link>
            <Link href="#duvidas" className="transition-colors hover:text-primary">
              Dúvidas
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              Entrar
            </Link>
            <Link
              href="/register"
              className="hidden rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:inline-block"
            >
              Começar agora
            </Link>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        {/* Primeira dobra: a promessa, um botão, três garantias e a tela do
            produto ao lado — a conversa é o argumento, não ilustração. */}
        <section className="relative overflow-hidden bg-[linear-gradient(180deg,color-mix(in_oklch,var(--primary)_7%,var(--background))_0%,var(--background)_100%)]">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-primary/15 blur-3xl"
          />
          <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pt-24 lg:pb-20">
            <div className="flex flex-col items-start gap-6">
              <h1 className="text-[2.6rem] leading-[1.05] font-bold tracking-tight text-balance sm:text-6xl">
                Seu WhatsApp atendendo{" "}
                <span className="text-primary">sozinho, 24 horas.</span>
              </h1>
              <p className="max-w-md text-lg leading-relaxed text-muted-foreground text-pretty">
                A IA responde na hora e chama sua equipe quando precisa de gente.
              </p>
              <Link href="/register" className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3.5 text-[15px] font-semibold text-primary-foreground shadow-[0_8px_20px_-8px_color-mix(in_oklch,var(--primary)_70%,transparent)] transition-all hover:-translate-y-px hover:bg-primary/90">
                Começar agora
                <ArrowRight className="size-4" />
              </Link>
              <ul className="flex flex-col gap-2 pt-1">
                {GARANTIAS.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-[15px] font-medium">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative">
              <ConversaDemo />
            </div>
          </div>
        </section>

        <section id="recursos" className="scroll-mt-20">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-12 px-5 py-20">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
                Como a {SITE_NAME} te ajuda
              </span>
              <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                Atenda mais rápido e nunca perca um cliente
              </h2>
            </div>

            <div className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {RECURSOS.map((recurso) => (
                <div
                  key={recurso.titulo}
                  className="group flex items-center gap-4 rounded-2xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_12px_32px_-16px_oklch(0_0_0/25%)]"
                >
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <recurso.icone className="size-5.5" />
                  </span>
                  <h3 className="text-[15px] leading-snug font-semibold text-balance">
                    {recurso.titulo}
                  </h3>
                </div>
              ))}
            </div>

            {/* A ordem importa de verdade — não dá pra ensinar a IA antes
                de conectar o número —, por isso numerada. */}
            <ol className="grid w-full gap-6 border-t pt-12 sm:grid-cols-3">
              {PASSOS.map((passo, indice) => (
                <li key={passo.titulo} className="flex items-start gap-3">
                  <span className="text-3xl leading-none font-bold text-primary/30 tabular-nums">
                    {indice + 1}
                  </span>
                  <div className="flex flex-col gap-1">
                    <h3 className="font-semibold">{passo.titulo}</h3>
                    <p className="text-sm text-muted-foreground text-pretty">{passo.texto}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-primary text-primary-foreground">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-5 py-16 text-center">
            <h2 className="max-w-2xl text-2xl font-bold tracking-tight text-balance sm:text-3xl">
              Pare de perder clientes por demora no WhatsApp
            </h2>
            <p className="max-w-lg text-primary-foreground/85 text-pretty">
              Resposta em segundos, a qualquer hora — até de madrugada.
            </p>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3.5 text-[15px] font-semibold text-primary shadow-lg transition-all hover:-translate-y-px hover:bg-white/90"
            >
              Começar agora
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>

        <section id="precos" className="scroll-mt-20">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-10 px-5 py-20">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
                Preço
              </span>
              <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                Um plano só, tudo incluso
              </h2>
            </div>

            <div className="w-full max-w-md rounded-3xl border bg-card p-8 shadow-[0_24px_60px_-30px_oklch(0_0_0/30%)]">
              <div className="flex items-baseline gap-1.5">
                <span className="text-5xl font-bold tracking-tight">R$ 197</span>
                <span className="text-muted-foreground">/mês</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Sem fidelidade. Cancele quando quiser.</p>
              <ul className="my-7 flex flex-col gap-3">
                {PLANO_INCLUI.map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-[15px]">
                    <Check className="size-4.5 shrink-0 text-primary" strokeWidth={2.5} />
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/register" className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3.5 text-[15px] font-semibold text-primary-foreground shadow-[0_8px_20px_-8px_color-mix(in_oklch,var(--primary)_70%,transparent)] transition-all hover:-translate-y-px hover:bg-primary/90 w-full">
                Assinar agora
              </Link>
            </div>
          </div>
        </section>

        <section id="duvidas" className="scroll-mt-20 border-t bg-muted/40">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-20">
            <h2 className="text-center text-3xl font-bold tracking-tight text-balance">
              Dúvidas frequentes
            </h2>

            {/* <details>, e não um acordeão em JavaScript: o conteúdo já
                está no HTML — visível pro buscador e pro leitor de tela — e
                abre sem carregar nada. */}
            <div className="flex flex-col gap-3">
              {PERGUNTAS.map((item) => (
                <details key={item.pergunta} className="group rounded-2xl border bg-card px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                    {item.pergunta}
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="pt-3 text-[15px] leading-relaxed text-muted-foreground text-pretty">
                    {item.resposta}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <Marca className="size-5" />
            {SITE_NAME}
          </span>
          <nav className="flex items-center gap-5">
            <Link href="/termos" className="transition-colors hover:text-foreground">
              Termos de uso
            </Link>
            <Link href="/privacidade" className="transition-colors hover:text-foreground">
              Privacidade
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
