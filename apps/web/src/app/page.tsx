import {
  ArrowRight,
  BookOpenText,
  ChevronDown,
  Clock,
  MessageCircle,
  Route,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ConversaDemo } from "@/components/publico/conversa-demo";
import { apiFetchServer } from "@/lib/api-server";
import { SITE_DESCRIPTION, SITE_NAME, absoluto } from "@/lib/site";
import type { MeResponse } from "@/lib/types";

/**
 * O que a Inteliwa faz, dito pelo problema que resolve e não pelo recurso.
 *
 * "Base de conhecimento com RAG" não diz nada pra quem tem um escritório
 * com três atendentes; "ela responde a partir dos seus documentos" diz.
 * Cada item aqui é uma frase que o dono do negócio reconheceria como uma
 * dor que ele tem hoje.
 */
const RECURSOS = [
  {
    icone: MessageCircle,
    titulo: "Responde na hora, a qualquer hora",
    texto:
      "A IA atende sozinha o que é repetitivo — horário, preço, documento necessário — inclusive às duas da manhã de domingo.",
  },
  {
    icone: BookOpenText,
    titulo: "Aprende com os seus documentos",
    texto:
      "Suba contratos, tabelas e manuais. A IA responde a partir do que está lá, não do que ela acha que sabe.",
  },
  {
    icone: Route,
    titulo: "Sabe a hora de chamar gente",
    texto:
      "Assunto urgente, promessa de retorno, caso sensível: a conversa vai pra pessoa certa, com o motivo escrito.",
  },
  {
    icone: Users,
    titulo: "Time inteiro na mesma tela",
    texto:
      "Filas por setor, quem assumiu o quê, permissões por papel. Ninguém responde por cima de ninguém.",
  },
  {
    icone: Clock,
    titulo: "Histórico que não evapora",
    texto:
      "O WhatsApp apaga anexo depois de 30 dias. Aqui a cópia fica — a procuração enviada hoje abre no ano que vem.",
  },
  {
    icone: ShieldCheck,
    titulo: "Cada empresa no seu canto",
    texto:
      "Isolamento aplicado no banco, credenciais criptografadas e acesso separado por pessoa.",
  },
];

/**
 * Perguntas que aparecem antes de alguém criar conta.
 *
 * Não é enfeite de página: são as três objeções reais de quem chega —
 * "vou ter que trocar de número?", "quanto custa?", "a IA vai responder
 * besteira pro meu cliente?". Responder aqui tira o atrito de quem está
 * decidindo, e de quebra alimenta o bloco de perguntas frequentes do
 * Google (ver o JSON-LD lá embaixo), que ocupa mais espaço no resultado
 * de busca do que um link comum.
 */
const PERGUNTAS = [
  {
    pergunta: "Preciso trocar o número de WhatsApp da minha empresa?",
    resposta:
      "Não. O número que você já usa é conectado em um clique pelo próprio botão da Meta, e o histórico do celular é importado. Durante a coexistência dá pra continuar respondendo pelo aparelho: o que for digitado lá aparece no painel também.",
  },
  {
    pergunta: "Quanto custa?",
    resposta:
      "Você conecta seu próprio número e usa sua própria chave de inteligência artificial, então os custos da Meta e do provedor de IA são cobrados direto na sua conta, sem intermediário. A página de termos explica cada um deles.",
  },
  {
    pergunta: "E se a IA não souber responder?",
    resposta:
      "Ela transfere pra uma pessoa. O sistema confere o que a IA prometeu contra o que ela realmente fez: se o texto disse que alguém da equipe vai assumir e a transferência não aconteceu, a conversa é escalada mesmo assim, com o motivo escrito pra quem for atender.",
  },
  {
    pergunta: "Quantas pessoas podem atender no mesmo número?",
    resposta:
      "Quantas você quiser. Cada conversa tem um responsável visível, filas por setor decidem quem vê o quê, e as permissões são configuradas por papel — ninguém responde por cima de ninguém.",
  },
  {
    pergunta: "Os anexos somem depois de 30 dias, como no WhatsApp?",
    resposta:
      "Não. A Meta apaga a mídia depois de 30 dias; a Inteliwa guarda uma cópia própria em armazenamento separado. Uma procuração enviada hoje continua abrindo no ano que vem.",
  },
];

const PASSOS = [
  {
    titulo: "Conecte o número",
    texto:
      "O WhatsApp da empresa é conectado em um clique, pelo próprio botão da Meta. Não precisa trocar de número nem perder as conversas que já existem.",
  },
  {
    titulo: "Ensine o que ela precisa saber",
    texto:
      "Escreva as instruções, suba os documentos e diga o que a IA nunca deve responder sozinha. Leva uma tarde.",
  },
  {
    titulo: "Deixe o time atender o que importa",
    texto:
      "A IA cuida do repetitivo. A equipe recebe o que exige gente — já com o contexto e os dados do cliente coletados.",
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
    title: "Seu cliente pergunta às duas da manhã. Alguém responde.",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Seu cliente pergunta às duas da manhã. Alguém responde.",
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

      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <span className="text-base font-semibold tracking-tight">{SITE_NAME}</span>
          <nav className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Entrar
            </Link>
            <Link
              href="/register"
              className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Criar conta
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        {/* A conversa ao lado do texto, e não abaixo: ela é o argumento, não
            a ilustração do argumento. Em telas estreitas ela desce, mas
            continua acima de tudo o mais. */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-24">
          <div className="flex flex-col items-start gap-6">
            <span className="rounded-full border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
              Atendimento por WhatsApp com IA
            </span>

            <h1 className="text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">
              Seu cliente pergunta às duas da manhã.{" "}
              <span className="text-primary">Alguém responde.</span>
            </h1>

            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty">
              A Inteliwa atende no WhatsApp da sua empresa, resolve sozinha o que é repetitivo e
              chama a sua equipe quando o assunto pede gente — com o histórico inteiro na
              mesma tela.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Criar conta
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center rounded-md border px-5 py-3 text-sm font-medium transition-colors hover:bg-muted"
              >
                Já tenho conta
              </Link>
            </div>

            <p className="text-xs text-muted-foreground">
              Você conecta seu próprio número e usa sua própria chave de IA. Os custos da Meta
              e do provedor de IA são cobrados direto na sua conta —{" "}
              <Link href="/termos" className="underline underline-offset-4 hover:text-foreground">
                explicamos cada um
              </Link>
              .
            </p>
          </div>

          <ConversaDemo />
        </section>

        <section className="border-y bg-muted/30">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5 py-16">
            <div className="flex flex-col gap-3">
              <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                Como funciona
              </h2>
              <p className="max-w-2xl text-muted-foreground text-pretty">
                Três passos, nessa ordem. O terceiro é o único que dura o ano inteiro.
              </p>
            </div>

            {/* A numeração aqui não é enfeite: a ordem importa de verdade —
                não dá pra ensinar a IA antes de conectar o número. */}
            <ol className="grid gap-6 md:grid-cols-3">
              {PASSOS.map((passo, indice) => (
                <li key={passo.titulo} className="flex flex-col gap-3 rounded-xl border bg-card p-6">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary tabular-nums">
                    {indice + 1}
                  </span>
                  <h3 className="text-base font-semibold tracking-tight">{passo.titulo}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                    {passo.texto}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5 py-16">
          <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            O que vem junto
          </h2>

          <div className="grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {RECURSOS.map((recurso) => (
              <div key={recurso.titulo} className="flex flex-col gap-2.5">
                <recurso.icone className="size-5 text-primary" />
                <h3 className="text-base font-semibold tracking-tight">{recurso.titulo}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                  {recurso.texto}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t bg-muted/30">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-16">
            <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Perguntas que todo mundo faz
            </h2>

            {/* <details>, e não um acordeão em JavaScript: o conteúdo já
                está no HTML da primeira resposta do servidor — visível pro
                buscador e pro leitor de tela — e abre sem carregar nada. */}
            <div className="flex flex-col divide-y rounded-xl border bg-card">
              {PERGUNTAS.map((item) => (
                <details key={item.pergunta} className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium">
                    {item.pergunta}
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="pt-3 text-sm leading-relaxed text-muted-foreground text-pretty">
                    {item.resposta}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-5 py-16 sm:items-center sm:text-center">
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Comece com o número que você já usa
            </h2>
            <p className="max-w-xl text-muted-foreground text-pretty">
              Sem trocar de linha, sem perder conversa antiga e sem contrato de fidelidade.
            </p>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Criar conta
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>{SITE_NAME} — atendimento por WhatsApp com inteligência artificial.</span>
          <nav className="flex items-center gap-4">
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
