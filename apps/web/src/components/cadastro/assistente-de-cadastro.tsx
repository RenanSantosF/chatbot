"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Marca } from "@/components/marca";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import {
  erroDaEmpresa,
  erroDaSenha,
  erroDoEmail,
  erroDoNome,
  forcaDaSenha,
  primeiroNome,
} from "@/lib/cadastro";
import {
  campanhaGuardada,
  guardarCampanha,
  registrarPasso,
  visitante,
} from "@/lib/rastreio";
import { SITE_NAME } from "@/lib/site";
import { cn } from "@/lib/utils";
import { PreviaDaEmpresa } from "./previa-da-empresa";

/**
 * Criar conta, uma pergunta por vez.
 *
 * O formulário de cinco campos numa tela só funcionava, mas parecia
 * burocracia — e é a primeira coisa do produto que a pessoa toca. Aqui
 * cada resposta é um passo com título grande, o Enter avança, e do lado
 * uma prévia vai montando, ao vivo, o atendimento da empresa dela (ver
 * PreviaDaEmpresa). Mais passos, mas cada um é uma coisa só: a pessoa
 * nunca tem que pensar no que falta.
 *
 * Os dados e as regras são os mesmos de antes (ver lib/cadastro e o
 * RegisterDto na API); a conta só nasce no último passo, junto da ida pro
 * pagamento — até lá nada é gravado.
 */

const PASSOS = [
  "inicio",
  "nome",
  "empresa",
  "email",
  "senha",
  "origem",
  "revisao",
] as const;
type Passo = (typeof PASSOS)[number];
/** Quantos passos contam no "2 de 6": o de boas-vindas não é pergunta. */
const PERGUNTAS = PASSOS.length - 1;

const PRECO_MENSAL = "167";

/** "Onde nos conheceu?" — opcional, em um clique. Vai pro painel da plataforma. */
const ORIGENS = [
  { valor: "instagram", rotulo: "Instagram" },
  { valor: "indicacao", rotulo: "Indicação" },
  { valor: "google", rotulo: "Google" },
  { valor: "youtube", rotulo: "YouTube" },
  { valor: "tiktok", rotulo: "TikTok" },
  { valor: "facebook", rotulo: "Facebook" },
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "outro", rotulo: "Outro lugar" },
];

/** O que a prévia está mostrando, dito em uma linha embaixo dela. */
const LEGENDA: Record<Passo, string> = {
  inicio: "É assim que seus clientes vão ser atendidos.",
  nome: "Você acompanha tudo pelo painel — a IA cuida do resto.",
  empresa: "A assistente já se apresenta com o nome da sua empresa.",
  email: "Um só número de WhatsApp para a equipe inteira.",
  senha: "A IA anota o pedido e passa para a equipe na hora certa.",
  origem: "Atendimento 24 horas, sem ninguém de plantão.",
  revisao: "Pronto. É só conectar o WhatsApp depois do pagamento.",
};

/** O que acontece enquanto a conta nasce — e o que a tela conta que está acontecendo. */
const CRIANDO = [
  "Criando o espaço da sua empresa",
  "Preparando sua assistente de IA",
  "Montando seu painel de atendimento",
  "Abrindo o pagamento seguro",
];

interface Dados {
  ownerName: string;
  companyName: string;
  email: string;
  password: string;
  comoConheceu: string | null;
  comoConheceuDetalhe: string;
}

export function AssistenteDeCadastro() {
  const [indice, setIndice] = useState(0);
  const [saindo, setSaindo] = useState(false);
  const [direcao, setDirecao] = useState<1 | -1>(1);
  const [dados, setDados] = useState<Dados>({
    ownerName: "",
    companyName: "",
    email: "",
    password: "",
    comoConheceu: null,
    comoConheceuDetalhe: "",
  });
  const [erro, setErro] = useState<string | null>(null);
  // O campo balança por meio segundo a cada resposta recusada. Por
  // estado, e não trocando a `key` do campo: remontar o campo tirava o
  // foco dele, e o que a pessoa digitava em seguida ia pro nada.
  const [tremendo, setTremendo] = useState(false);
  const tremidaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [criando, setCriando] = useState(false);
  const [feitos, setFeitos] = useState(0);
  const campoRef = useRef<HTMLInputElement | null>(null);
  const trocaRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const passo = PASSOS[indice];
  const nome = primeiroNome(dados.ownerName);

  // O passo "abriu o cadastro" do funil — e a campanha, pra quem chegou
  // direto aqui por um link de anúncio, sem passar pela landing.
  useEffect(() => {
    guardarCampanha();
    registrarPasso("cadastro_aberto");
    return () => {
      if (trocaRef.current) clearTimeout(trocaRef.current);
      if (tremidaRef.current) clearTimeout(tremidaRef.current);
    };
  }, []);

  // O cursor já espera no campo de cada passo: responder é só digitar.
  // Um tico depois da entrada, pra o foco não brigar com a animação (e o
  // teclado do celular não abrir antes de o campo estar no lugar).
  useEffect(() => {
    if (saindo || criando) return;
    const foco = setTimeout(
      () => campoRef.current?.focus({ preventScroll: true }),
      260,
    );
    return () => clearTimeout(foco);
  }, [indice, saindo, criando]);

  // Enter avança de qualquer lugar da tela, e não só de dentro do campo:
  // no passo de boas-vindas (e no de origem, que é de clicar) não há campo
  // com foco, e "pressione Enter" tem que ser verdade em todo passo.
  const avancarRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (
        evento.key !== "Enter" ||
        evento.defaultPrevented ||
        evento.isComposing
      )
        return;
      const alvo = evento.target as HTMLElement | null;
      // Dentro de campo ou botão, o próprio formulário (ou o botão) cuida.
      if (alvo?.closest("input, textarea, button, a, [role=button]")) return;
      evento.preventDefault();
      avancarRef.current();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  function mudar<K extends keyof Dados>(campo: K, valor: Dados[K]) {
    setDados((atual) => ({ ...atual, [campo]: valor }));
    if (erro) setErro(null);
  }

  function irPara(destino: number) {
    if (destino === indice || saindo) return;
    setDirecao(destino > indice ? 1 : -1);
    setErro(null);
    setSaindo(true);
    trocaRef.current = setTimeout(() => {
      setIndice(destino);
      setSaindo(false);
    }, 200);
  }

  function tremer() {
    if (tremidaRef.current) clearTimeout(tremidaRef.current);
    setTremendo(false);
    // Um quadro depois: tirar e pôr a classe no mesmo render não reinicia
    // a animação quando o erro se repete.
    requestAnimationFrame(() => setTremendo(true));
    tremidaRef.current = setTimeout(() => setTremendo(false), 450);
  }

  function recusar(mensagem: string) {
    setErro(mensagem);
    tremer();
    campoRef.current?.focus();
  }

  function erroDoPasso(p: Passo): string | null {
    if (p === "nome") return erroDoNome(dados.ownerName);
    if (p === "empresa") return erroDaEmpresa(dados.companyName);
    if (p === "email") return erroDoEmail(dados.email);
    if (p === "senha") return erroDaSenha(dados.password);
    return null;
  }

  function avancar(evento?: React.FormEvent) {
    evento?.preventDefault();
    if (saindo || criando) return;
    const problema = erroDoPasso(passo);
    if (problema) return recusar(problema);
    if (passo === "revisao") return void criarConta();
    irPara(indice + 1);
  }

  function escolherOrigem(valor: string) {
    const nova = dados.comoConheceu === valor ? null : valor;
    mudar("comoConheceu", nova);
    // Um clique responde: segue sozinho, sem pedir o "Continuar". "Outro"
    // fica, porque abre o campo pra dizer onde.
    if (nova && nova !== "outro") {
      trocaRef.current = setTimeout(
        () => irPara(PASSOS.indexOf("revisao")),
        380,
      );
    }
  }

  /**
   * A conta nasce aqui, e a pessoa vai direto pro Checkout do Stripe.
   *
   * A lista de "criando…" anda num ritmo próprio enquanto as duas chamadas
   * correm; o último item só fica verde quando o pagamento está pronto pra
   * abrir. Se algo falhar, volta pro passo que precisa de correção (e-mail
   * já usado vai pro passo do e-mail), com os dados todos preservados.
   */
  async function criarConta() {
    setCriando(true);
    setFeitos(0);
    const ritmo = setInterval(
      () => setFeitos((n) => Math.min(n + 1, CRIANDO.length - 1)),
      750,
    );
    try {
      await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          companyName: dados.companyName.trim(),
          ownerName: dados.ownerName.trim(),
          email: dados.email.trim(),
          password: dados.password,
          ...(dados.comoConheceu ? { comoConheceu: dados.comoConheceu } : {}),
          ...(dados.comoConheceu === "outro" && dados.comoConheceuDetalhe.trim()
            ? { comoConheceuDetalhe: dados.comoConheceuDetalhe.trim() }
            : {}),
          utm: campanhaGuardada(),
          visitante: visitante() ?? undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const { url } = await apiFetch<{ url: string }>("/billing/checkout", {
        method: "POST",
      });
      clearInterval(ritmo);
      setFeitos(CRIANDO.length);
      setTimeout(() => {
        window.location.href = url;
      }, 650);
    } catch (falha) {
      clearInterval(ritmo);
      setCriando(false);
      const mensagem =
        falha instanceof ApiError
          ? falha.message
          : "Não deu pra criar sua conta agora. Tente de novo.";
      // E-mail já usado: a conta NÃO foi criada; o passo certo é o do e-mail.
      if (falha instanceof ApiError && falha.status === 409) {
        setIndice(PASSOS.indexOf("email"));
      }
      setErro(mensagem);
      tremer();
    }
  }

  useEffect(() => {
    avancarRef.current = () => avancar();
  });

  const forca = forcaDaSenha(dados.password);
  const progresso = indice / PERGUNTAS;

  return (
    <div className="flex min-h-dvh flex-col bg-white text-neutral-950 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* A linha de progresso, colada no topo da tela. */}
      <div
        className="fixed inset-x-0 top-0 z-20 h-[3px] bg-neutral-100"
        aria-hidden
      >
        <div
          className="h-full bg-primary transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ width: `${Math.max(progresso, 0.02) * 100}%` }}
        />
      </div>

      <section className="relative flex min-h-dvh flex-col px-6 py-6 sm:px-12 lg:px-16">
        <header className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
          >
            <Marca className="size-6" />
            {SITE_NAME}
          </Link>
          <p className="text-sm text-neutral-500">
            Já tem conta?{" "}
            <Link
              href="/login"
              className="font-medium text-neutral-950 underline-offset-4 hover:underline"
            >
              Entrar
            </Link>
          </p>
        </header>

        <div className="flex flex-1 items-center py-10">
          {criando ? (
            <Criando empresa={dados.companyName.trim()} feitos={feitos} />
          ) : (
            <div
              key={indice}
              className={cn(
                "w-full max-w-xl",
                saindo ? "cadastro-sai" : "cadastro-entra",
              )}
              style={{ "--dir": direcao } as React.CSSProperties}
            >
              {passo === "inicio" ? (
                <form onSubmit={avancar} className="flex flex-col gap-10">
                  <div className="flex flex-col gap-5">
                    <Selo>Comece em menos de 2 minutos</Selo>
                    <Titulo
                      texto="Seu WhatsApp atendendo sozinho, 24 horas por dia."
                      grande
                    />
                    <p className="cadastro-depois max-w-md text-lg leading-relaxed text-neutral-500 text-pretty">
                      Algumas perguntas rápidas e sua empresa está no ar — com
                      uma assistente de IA que responde, organiza e passa para a
                      sua equipe na hora certa.
                    </p>
                  </div>
                  <ul className="flex flex-col gap-3">
                    {[
                      {
                        icone: Sparkles,
                        texto:
                          "IA inclusa, treinada com as informações da sua empresa",
                      },
                      {
                        icone: Users,
                        texto: "Atendentes ilimitados no mesmo número",
                      },
                      {
                        icone: ShieldCheck,
                        texto: "Sem fidelidade — cancele quando quiser",
                      },
                    ].map((item, i) => (
                      <li
                        key={item.texto}
                        className="cadastro-depois flex items-center gap-3 text-[15px] text-neutral-700"
                        style={{ "--i": i + 1 } as React.CSSProperties}
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <item.icone className="size-4" />
                        </span>
                        {item.texto}
                      </li>
                    ))}
                  </ul>
                  <Acoes
                    indice={indice}
                    rotulo="Começar"
                    onVoltar={() => irPara(indice - 1)}
                    i={4}
                  />
                </form>
              ) : null}

              {passo === "nome" ? (
                <form onSubmit={avancar} className="flex flex-col gap-10">
                  <Cabecalho
                    indice={indice}
                    titulo="Primeiro, como podemos te chamar?"
                  />
                  <Campo icone={UserRound} tremer={tremendo} erro={erro}>
                    <input
                      ref={campoRef}
                      value={dados.ownerName}
                      onChange={(e) => mudar("ownerName", e.target.value)}
                      placeholder="Seu nome completo"
                      autoComplete="name"
                      maxLength={120}
                      className={CAMPO}
                    />
                  </Campo>
                  <Acoes indice={indice} onVoltar={() => irPara(indice - 1)} />
                </form>
              ) : null}

              {passo === "empresa" ? (
                <form onSubmit={avancar} className="flex flex-col gap-10">
                  <Cabecalho
                    indice={indice}
                    titulo={
                      nome
                        ? `Prazer, ${nome}. Qual é o nome da sua empresa?`
                        : "Qual é o nome da sua empresa?"
                    }
                    apoio="É o nome com que a assistente vai se apresentar aos seus clientes — olhe a prévia."
                  />
                  <Campo icone={Building2} tremer={tremendo} erro={erro}>
                    <input
                      ref={campoRef}
                      value={dados.companyName}
                      onChange={(e) => mudar("companyName", e.target.value)}
                      placeholder="Ex.: Clínica Sorriso"
                      autoComplete="organization"
                      maxLength={120}
                      className={CAMPO}
                    />
                  </Campo>
                  <Acoes indice={indice} onVoltar={() => irPara(indice - 1)} />
                </form>
              ) : null}

              {passo === "email" ? (
                <form
                  onSubmit={avancar}
                  className="flex flex-col gap-10"
                  noValidate
                >
                  <Cabecalho
                    indice={indice}
                    titulo="Qual e-mail você vai usar para entrar?"
                    apoio="É o seu acesso ao painel e onde chegam os avisos importantes da conta."
                  />
                  <Campo icone={Mail} tremer={tremendo} erro={erro}>
                    <input
                      ref={campoRef}
                      type="email"
                      inputMode="email"
                      value={dados.email}
                      onChange={(e) => mudar("email", e.target.value)}
                      placeholder="voce@empresa.com.br"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      className={CAMPO}
                    />
                  </Campo>
                  <Acoes indice={indice} onVoltar={() => irPara(indice - 1)} />
                </form>
              ) : null}

              {passo === "senha" ? (
                <form onSubmit={avancar} className="flex flex-col gap-10">
                  <Cabecalho
                    indice={indice}
                    titulo="Agora, crie uma senha."
                    apoio="Ela protege as conversas dos seus clientes. Capriche."
                  />
                  {/* Pro gerenciador de senhas saber de qual conta é esta senha. */}
                  <input
                    type="email"
                    autoComplete="username"
                    value={dados.email}
                    readOnly
                    hidden
                  />
                  <div className="flex flex-col gap-5">
                    <Campo icone={Lock} tremer={tremendo} erro={erro}>
                      <input
                        ref={campoRef}
                        type={mostrarSenha ? "text" : "password"}
                        value={dados.password}
                        onChange={(e) => mudar("password", e.target.value)}
                        placeholder="Pelo menos 8 caracteres"
                        autoComplete="new-password"
                        maxLength={72}
                        className={CAMPO}
                      />
                      <button
                        type="button"
                        onClick={() => setMostrarSenha((v) => !v)}
                        aria-label={
                          mostrarSenha ? "Esconder senha" : "Mostrar senha"
                        }
                        className="shrink-0 rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-950"
                      >
                        {mostrarSenha ? (
                          <EyeOff className="size-5" />
                        ) : (
                          <Eye className="size-5" />
                        )}
                      </button>
                    </Campo>
                    <div
                      className="cadastro-depois flex flex-col gap-3"
                      style={{ "--i": 1 } as React.CSSProperties}
                    >
                      <div className="flex items-center gap-3">
                        <div className="grid flex-1 grid-cols-3 gap-1.5">
                          {[1, 2, 3].map((n) => (
                            <span
                              key={n}
                              className={cn(
                                "h-1 rounded-full transition-colors duration-500",
                                forca.nivel >= n
                                  ? forca.nivel === 1
                                    ? "bg-amber-400"
                                    : "bg-primary"
                                  : "bg-neutral-100",
                              )}
                            />
                          ))}
                        </div>
                        <span className="w-12 text-right text-xs font-medium text-neutral-500">
                          {forca.rotulo}
                        </span>
                      </div>
                      <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
                        {forca.requisitos.map((r) => (
                          <li
                            key={r.texto}
                            className={cn(
                              "flex items-center gap-1.5 text-[13px] transition-colors",
                              r.ok ? "text-neutral-950" : "text-neutral-400",
                            )}
                          >
                            <Visto feito={r.ok} pequeno />
                            {r.texto}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <Acoes indice={indice} onVoltar={() => irPara(indice - 1)} />
                </form>
              ) : null}

              {passo === "origem" ? (
                <form onSubmit={avancar} className="flex flex-col gap-10">
                  <Cabecalho
                    indice={indice}
                    titulo="Última pergunta: onde conheceu a Bellis?"
                    apoio="Opcional — mas ajuda muito a gente a chegar em mais empresas como a sua."
                  />
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {ORIGENS.map((origem, i) => (
                        <button
                          key={origem.valor}
                          type="button"
                          aria-pressed={dados.comoConheceu === origem.valor}
                          onClick={() => escolherOrigem(origem.valor)}
                          className={cn(
                            "cadastro-depois rounded-xl border px-3 py-3 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5",
                            dados.comoConheceu === origem.valor
                              ? "border-neutral-950 bg-neutral-950 text-white shadow-lg"
                              : "border-neutral-200 hover:border-neutral-950",
                          )}
                          style={{ "--i": i * 0.5 } as React.CSSProperties}
                        >
                          {origem.rotulo}
                        </button>
                      ))}
                    </div>
                    {dados.comoConheceu === "outro" ? (
                      <Campo icone={Sparkles} erro={null}>
                        <input
                          ref={campoRef}
                          value={dados.comoConheceuDetalhe}
                          onChange={(e) =>
                            mudar("comoConheceuDetalhe", e.target.value)
                          }
                          placeholder="Conta pra gente onde"
                          maxLength={120}
                          className={CAMPO}
                        />
                      </Campo>
                    ) : null}
                  </div>
                  <Acoes
                    indice={indice}
                    rotulo={dados.comoConheceu ? "Continuar" : "Pular"}
                    onVoltar={() => irPara(indice - 1)}
                  />
                </form>
              ) : null}

              {passo === "revisao" ? (
                <form onSubmit={avancar} className="flex flex-col gap-8">
                  <Cabecalho
                    indice={indice}
                    titulo={nome ? `Tudo pronto, ${nome}.` : "Tudo pronto."}
                    apoio="Confira os dados. No próximo passo você assina com segurança pelo Stripe e já entra no painel."
                  />
                  <div
                    className="cadastro-depois overflow-hidden rounded-2xl border border-neutral-200"
                    style={{ "--i": 1 } as React.CSSProperties}
                  >
                    {[
                      {
                        rotulo: "Empresa",
                        valor: dados.companyName.trim(),
                        passo: "empresa" as Passo,
                      },
                      {
                        rotulo: "Responsável",
                        valor: dados.ownerName.trim(),
                        passo: "nome" as Passo,
                      },
                      {
                        rotulo: "E-mail",
                        valor: dados.email.trim(),
                        passo: "email" as Passo,
                      },
                    ].map((linha) => (
                      <div
                        key={linha.rotulo}
                        className="flex items-center gap-4 border-b border-neutral-100 px-5 py-3.5 last:border-b-0"
                      >
                        {/* No celular o rótulo vai em cima: lado a lado, o
                            valor sobrava com três letras e reticências. */}
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                          <span className="shrink-0 text-xs text-neutral-500 sm:w-24 sm:text-sm">
                            {linha.rotulo}
                          </span>
                          <span className="min-w-0 truncate font-medium">
                            {linha.valor}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => irPara(PASSOS.indexOf(linha.passo))}
                          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                          Alterar
                        </button>
                      </div>
                    ))}
                  </div>
                  <div
                    className="cadastro-depois flex flex-col gap-4 rounded-2xl bg-neutral-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between"
                    style={{ "--i": 2 } as React.CSSProperties}
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium tracking-[0.18em] text-primary uppercase">
                        Plano {SITE_NAME}
                      </span>
                      <span className="text-3xl font-semibold tracking-tight">
                        R$ {PRECO_MENSAL}
                        <span className="text-base font-normal text-white/60">
                          /mês
                        </span>
                      </span>
                    </div>
                    <ul className="flex flex-col gap-1.5 text-sm text-white/80">
                      {[
                        "Atendentes ilimitados",
                        "IA inclusa",
                        "Sem fidelidade",
                      ].map((item) => (
                        <li key={item} className="flex items-center gap-2">
                          <Visto feito pequeno />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {erro ? <Erro mensagem={erro} /> : null}
                  <Acoes
                    indice={indice}
                    rotulo="Criar minha empresa"
                    onVoltar={() => irPara(indice - 1)}
                    i={3}
                  />
                  <p
                    className="cadastro-depois text-xs leading-relaxed text-neutral-500"
                    style={{ "--i": 4 } as React.CSSProperties}
                  >
                    Pagamento processado pelo Stripe — nenhum dado de cartão
                    passa pelos nossos servidores. Ao continuar, você concorda
                    com os{" "}
                    <Link
                      href="/termos"
                      className="underline underline-offset-4 hover:text-neutral-950"
                    >
                      Termos de uso
                    </Link>{" "}
                    e a{" "}
                    <Link
                      href="/privacidade"
                      className="underline underline-offset-4 hover:text-neutral-950"
                    >
                      Política de privacidade
                    </Link>
                    .
                  </p>
                </form>
              ) : null}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 text-xs text-neutral-400">
          <Lock className="size-3.5" />
          Seus dados ficam protegidos e nunca são compartilhados.
        </footer>
      </section>

      {/* O lado escuro: a prévia do atendimento, montando ao vivo. Some no
          celular — ali a tela inteira é da pergunta. */}
      <aside className="relative hidden overflow-hidden bg-neutral-950 lg:flex lg:flex-col lg:items-center lg:justify-center lg:gap-8 lg:p-12">
        <div
          className="cadastro-grade pointer-events-none absolute inset-0 invert"
          aria-hidden
        />
        <div
          className="cadastro-luz pointer-events-none absolute top-1/4 left-1/4 size-[28rem] rounded-full bg-primary/25 blur-[120px]"
          aria-hidden
        />
        <div className="relative flex w-full flex-col items-center gap-8">
          <PreviaDaEmpresa
            empresa={dados.companyName}
            responsavel={dados.ownerName}
            etapa={indice}
          />
          <p
            key={passo}
            className="cadastro-entra max-w-xs text-center text-sm leading-relaxed text-white/70"
          >
            <Bot className="mr-1.5 inline size-4 text-primary" />
            {LEGENDA[passo]}
          </p>
        </div>
      </aside>
    </div>
  );
}

/** O campo grande, sem caixa: só a linha de baixo, que fica verde no foco. */
const CAMPO =
  "min-w-0 flex-1 bg-transparent py-2 text-2xl font-medium tracking-tight text-neutral-950 outline-none placeholder:text-neutral-300 sm:text-3xl";

function Titulo({
  texto,
  grande = false,
}: {
  texto: string;
  grande?: boolean;
}) {
  return (
    <h1
      className={cn(
        "font-semibold tracking-tight text-balance",
        grande
          ? "text-4xl leading-[1.05] sm:text-6xl"
          : "text-3xl leading-tight sm:text-5xl",
      )}
    >
      {texto.split(" ").map((palavra, i) => (
        <span
          key={i}
          className="cadastro-palavra"
          style={{ "--i": i } as React.CSSProperties}
        >
          {palavra}
          {" "}
        </span>
      ))}
    </h1>
  );
}

function Selo({ children }: { children: React.ReactNode }) {
  return (
    <span className="cadastro-depois inline-flex w-fit items-center gap-2 text-xs font-semibold tracking-[0.18em] text-primary uppercase">
      <span className="h-px w-6 bg-primary" aria-hidden />
      {children}
    </span>
  );
}

function Cabecalho({
  indice,
  titulo,
  apoio,
}: {
  indice: number;
  titulo: string;
  apoio?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Selo>
        Passo {indice} de {PERGUNTAS}
      </Selo>
      <Titulo texto={titulo} />
      {apoio ? (
        <p className="cadastro-depois max-w-md text-base leading-relaxed text-neutral-500 text-pretty">
          {apoio}
        </p>
      ) : null}
    </div>
  );
}

function Campo({
  icone: Icone,
  tremer = false,
  erro,
  children,
}: {
  icone: typeof Mail;
  tremer?: boolean;
  erro: string | null;
  children: React.ReactNode;
}) {
  return (
    <div
      className="cadastro-depois flex flex-col gap-2"
      style={{ "--i": 1 } as React.CSSProperties}
    >
      <label
        className={cn(
          "group flex items-center gap-3 border-b-2 transition-colors duration-300 focus-within:border-primary",
          erro ? "border-destructive" : "border-neutral-200",
          tremer && "cadastro-treme",
        )}
      >
        <Icone
          className={cn(
            "size-6 shrink-0 transition-colors duration-300 group-focus-within:text-primary",
            erro ? "text-destructive" : "text-neutral-300",
          )}
        />
        {children}
      </label>
      {erro ? <Erro mensagem={erro} /> : null}
    </div>
  );
}

function Erro({ mensagem }: { mensagem: string }) {
  return (
    <p
      role="alert"
      className="cadastro-entra text-sm font-medium text-destructive"
    >
      {mensagem}
    </p>
  );
}

function Acoes({
  indice,
  rotulo = "Continuar",
  onVoltar,
  i = 2,
}: {
  indice: number;
  rotulo?: string;
  onVoltar: () => void;
  i?: number;
}) {
  return (
    <div
      className="cadastro-depois flex flex-wrap items-center gap-x-5 gap-y-3"
      style={{ "--i": i } as React.CSSProperties}
    >
      {indice > 0 ? (
        <button
          type="button"
          onClick={onVoltar}
          aria-label="Voltar"
          className="flex size-12 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 transition-all hover:border-neutral-950 hover:text-neutral-950"
        >
          <ArrowLeft className="size-5" />
        </button>
      ) : null}
      <button
        type="submit"
        className="group inline-flex h-12 items-center gap-2.5 rounded-full bg-neutral-950 pr-5 pl-7 text-[15px] font-medium text-white shadow-[0_10px_30px_-10px_oklch(0_0_0/60%)] transition-all duration-300 hover:bg-neutral-800 hover:shadow-[0_14px_36px_-12px_oklch(0.62_0.15_165/35%)] active:scale-[0.98]"
      >
        {rotulo}
        <span className="flex size-7 items-center justify-center rounded-full bg-white/10 transition-all duration-300 group-hover:translate-x-1 group-hover:bg-primary">
          <ArrowRight className="size-4" />
        </span>
      </button>
      <span className="hidden items-center gap-1.5 text-sm text-neutral-400 sm:flex">
        ou pressione
        <kbd className="rounded-md border border-neutral-200 px-1.5 py-0.5 font-sans text-xs text-neutral-600">
          Enter ↵
        </kbd>
      </span>
    </div>
  );
}

/** O visto que se desenha — verde quando feito, cinza quando não. */
function Visto({
  feito,
  pequeno = false,
}: {
  feito: boolean;
  pequeno?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full transition-colors duration-300",
        pequeno ? "size-4" : "size-7",
        feito
          ? "bg-primary text-primary-foreground"
          : "bg-neutral-100 text-transparent",
      )}
    >
      {feito ? (
        <svg
          viewBox="0 0 16 16"
          className={pequeno ? "size-2.5" : "size-4"}
          fill="none"
          aria-hidden
        >
          <path
            className="cadastro-visto"
            d="M3.5 8.5l3 3 6-7"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}

/** A conta nascendo: cada etapa ganha o seu visto, uma depois da outra. */
function Criando({ empresa, feitos }: { empresa: string; feitos: number }) {
  return (
    <div
      className="cadastro-entra flex w-full max-w-xl flex-col gap-10"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col gap-4">
        <span className="relative flex size-14 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
          <span className="relative flex size-14 items-center justify-center rounded-full bg-neutral-950">
            <Marca className="size-7" cor="#ffffff" />
          </span>
        </span>
        <Titulo texto={`Criando ${empresa || "sua empresa"}…`} />
      </div>
      <ul className="flex flex-col gap-4">
        {CRIANDO.map((etapa, i) => {
          const feito = i < feitos;
          const atual = i === feitos;
          return (
            <li
              key={etapa}
              className={cn(
                "cadastro-depois flex items-center gap-4 text-lg transition-colors duration-300",
                feito
                  ? "text-neutral-950"
                  : atual
                    ? "text-neutral-700"
                    : "text-neutral-300",
              )}
              style={{ "--i": i } as React.CSSProperties}
            >
              {feito ? (
                <Visto feito />
              ) : (
                <span className="flex size-7 shrink-0 items-center justify-center">
                  <span
                    className={cn(
                      "size-4 rounded-full border-2",
                      atual
                        ? "animate-spin border-primary border-t-transparent"
                        : "border-neutral-200",
                    )}
                  />
                </span>
              )}
              {etapa}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
