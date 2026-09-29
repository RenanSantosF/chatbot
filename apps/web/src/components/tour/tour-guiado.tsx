"use client";

import {
  ArrowLeft,
  ArrowRight,
  MousePointerClick,
  PartyPopper,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Marca } from "@/components/marca";
import { useRealtime } from "@/components/realtime-provider";
import { useSession } from "@/components/session-provider";
import { primeiroNome } from "@/lib/cadastro";
import {
  EVENTO_INICIAR_TOUR,
  marcarTourVisto,
  posicionarCartao,
  tourJaVisto,
  type Caixa,
} from "@/lib/tour";
import { cn } from "@/lib/utils";

/**
 * O tour do painel: um holofote que anda pelas partes da tela, com uma
 * explicação curta do lado de cada uma.
 *
 * Substitui o "leia a lista de primeiros passos" por "veja onde fica":
 * quem entra num painel novo não sabe o que é "Pendentes" nem onde se
 * assume uma conversa, e texto numa página separada não resolve isso. Aqui
 * a própria tela acende no lugar certo — e, onde faz sentido, pede o
 * clique de verdade (abrir uma conversa), porque fazer ensina mais que ler.
 *
 * Sempre dá pra sair: "Pular tour" em todo cartão e Esc. Aparece sozinho
 * uma vez, no computador, na primeira visita às conversas; depois só
 * quando alguém pede (ver `iniciarTour`, usado nos primeiros passos).
 */

interface Passo {
  id: string;
  /** Valor do `data-tour` do elemento a destacar. Sem alvo: cartão no centro. */
  alvo?: string;
  titulo: string;
  texto: string;
  /** Pede o clique no elemento destacado pra seguir. */
  clicar?: string;
  /** Quanto esperar o alvo aparecer (ex.: depois de abrir uma conversa). */
  esperarMs?: number;
}

const PASSOS: Passo[] = [
  { id: "boas-vindas", titulo: "", texto: "" },
  {
    id: "conversas",
    alvo: "nav-conversas",
    titulo: "Suas conversas",
    texto:
      "Todo o WhatsApp da empresa chega aqui, em tempo real. É a tela onde a equipe passa o dia.",
  },
  {
    id: "abas",
    alvo: "abas",
    titulo: "Organizado por situação",
    texto:
      "Pendentes esperam alguém da equipe. Em Aguardando, a vez é do cliente. Resolvidas ficam guardadas com todo o histórico.",
  },
  {
    id: "busca",
    alvo: "busca",
    titulo: "Ache qualquer cliente",
    texto:
      "Busque por nome ou número. Os filtros do lado separam por setor, prioridade e responsável.",
  },
  {
    id: "nova",
    alvo: "nova-conversa",
    titulo: "Comece uma conversa",
    texto:
      "Mande mensagem pra qualquer número direto daqui — não precisa esperar o cliente chamar.",
  },
  {
    id: "lista",
    alvo: "lista",
    titulo: "Abra uma conversa",
    texto:
      "Cada linha mostra quem é, a última mensagem, quem está cuidando e há quanto tempo o cliente espera.",
    clicar: "Clique em uma conversa da lista",
  },
  {
    id: "acoes",
    alvo: "acoes-conversa",
    titulo: "Assuma e resolva",
    texto:
      "“Assumir” tira a conversa da fila e avisa a equipe que ela é sua. Ao terminar, “Resolver” guarda o atendimento.",
    esperarMs: 2500,
  },
  {
    id: "composer",
    alvo: "composer",
    titulo: "Responda como no WhatsApp",
    texto:
      "Enter envia, Shift+Enter pula linha. Anexe arquivos, grave áudio — e digite / pra usar uma resposta pronta.",
    esperarMs: 1200,
  },
  {
    id: "cliente",
    alvo: "painel-cliente",
    titulo: "Tudo sobre o cliente",
    texto:
      "Quem está atendendo, anotações da equipe, o que a IA já coletou e as tarefas combinadas — sem sair da conversa.",
  },
  {
    id: "visao",
    alvo: "nav-visao",
    titulo: "Os números do atendimento",
    texto: "Tempo de resposta, volume por dia e quanto a IA resolveu sozinha.",
  },
  {
    id: "clientes",
    alvo: "nav-clientes",
    titulo: "Sua base de clientes",
    texto:
      "Todos os contatos num lugar só, com histórico, anotações e importação por planilha.",
  },
  {
    id: "config",
    alvo: "nav-config",
    titulo: "Configure a IA e o WhatsApp",
    texto:
      "Conecte o número, ensine a IA sobre a empresa, defina horários, setores e convide a equipe.",
  },
  {
    id: "avisos",
    alvo: "avisos",
    titulo: "Não perca nenhuma mensagem",
    texto:
      "Ative os avisos e o navegador te chama quando chegar mensagem — mesmo com o painel minimizado.",
  },
  {
    id: "assistente",
    alvo: "assistente",
    titulo: "Seu assistente",
    texto:
      "Ficou com dúvida? Pergunte aqui. Ele explica qualquer parte do painel e te leva até ela.",
  },
  { id: "fim", titulo: "", texto: "" },
];

const PERGUNTAS = PASSOS.length - 2;
const FOLGA = 8; // o holofote fica um pouco maior que o elemento

/** O elemento do passo, se estiver de fato na tela (existe e tem tamanho). */
function acharAlvo(alvo: string): HTMLElement | null {
  const candidatos = document.querySelectorAll<HTMLElement>(
    `[data-tour="${alvo}"]`,
  );
  for (const el of candidatos) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function caixaDe(el: HTMLElement): Caixa {
  const r = el.getBoundingClientRect();
  // Recorta na tela: a lista inteira passa do rodapé, e um holofote que
  // sai da tela não diz onde está o que importa.
  const top = Math.max(r.top, 0);
  const left = Math.max(r.left, 0);
  const bottom = Math.min(r.bottom, window.innerHeight);
  const right = Math.min(r.right, window.innerWidth);
  return {
    top: top - FOLGA,
    left: left - FOLGA,
    width: right - left + FOLGA * 2,
    height: bottom - top + FOLGA * 2,
  };
}

export function TourGuiado() {
  const { user } = useSession();
  const { canal } = useRealtime();
  const pathname = usePathname();
  const router = useRouter();
  const [ativo, setAtivo] = useState(false);
  const [indice, setIndice] = useState(0);
  const [caixa, setCaixa] = useState<Caixa | null>(null);
  const [tela, setTela] = useState({ width: 1440, height: 900 });
  const [alturaDoCartao, setAlturaDoCartao] = useState(220);
  const [pedido, setPedido] = useState(false);
  const cartaoRef = useRef<HTMLDivElement | null>(null);
  const alvoRef = useRef<HTMLElement | null>(null);
  const direcaoRef = useRef<1 | -1>(1);

  const passo = PASSOS[indice];
  const nome = primeiroNome(user.name);

  const encerrar = useCallback(
    (como: "concluido" | "pulado") => {
      marcarTourVisto(user.id, como);
      setAtivo(false);
      setCaixa(null);
      alvoRef.current = null;
    },
    [user.id],
  );

  const comecar = useCallback(() => {
    direcaoRef.current = 1;
    setIndice(0);
    setCaixa(null);
    setAtivo(true);
  }, []);

  const irPara = useCallback((destino: number) => {
    direcaoRef.current = destino >= 0 ? 1 : -1;
    setIndice((atual) => {
      const alvo = atual + destino;
      return Math.min(Math.max(alvo, 0), PASSOS.length - 1);
    });
  }, []);

  // Sozinho, uma vez: primeira visita às conversas, em tela de computador
  // (no celular o painel é outro, e metade dos alvos nem aparece).
  useEffect(() => {
    if (
      pathname !== "/dashboard" ||
      tourJaVisto(user.id) ||
      window.innerWidth < 1024
    )
      return;
    const espera = setTimeout(comecar, 1500);
    return () => clearTimeout(espera);
  }, [pathname, user.id, comecar]);

  // A pedido (botão "Fazer o tour"), de qualquer tela: vai pras conversas
  // primeiro, que é onde o tour mora.
  useEffect(() => {
    const aoPedir = () => {
      if (window.location.pathname === "/dashboard") comecar();
      else {
        setPedido(true);
        router.push("/dashboard");
      }
    };
    window.addEventListener(EVENTO_INICIAR_TOUR, aoPedir);
    return () => window.removeEventListener(EVENTO_INICIAR_TOUR, aoPedir);
  }, [comecar, router]);

  useEffect(() => {
    if (!pedido || pathname !== "/dashboard") return;
    const espera = setTimeout(() => {
      setPedido(false);
      comecar();
    }, 700);
    return () => clearTimeout(espera);
  }, [pedido, pathname, comecar]);

  // Achar o alvo do passo. Se ele não está na tela (sem permissão pra
  // configurar, sem conversas na lista, avisos já ativados), o passo é
  // pulado no mesmo sentido em que a pessoa ia — depois de esperar um
  // pouco, porque alguns alvos só aparecem depois do clique anterior.
  useEffect(() => {
    if (!ativo) return;
    if (!passo.alvo) {
      // Passo sem alvo (boas-vindas, fim): o holofote vai pro centro
      // sozinho, porque `centro` só olha pro passo (ver abaixo).
      alvoRef.current = null;
      return;
    }
    const alvo = passo.alvo;
    const limite = Date.now() + (passo.esperarMs ?? 500);
    let cancelado = false;
    const procurar = () => {
      if (cancelado) return;
      const el = acharAlvo(alvo);
      if (el) {
        alvoRef.current = el;
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        setCaixa(caixaDe(el));
        return;
      }
      if (Date.now() < limite) {
        setTimeout(procurar, 100);
        return;
      }
      irPara(direcaoRef.current);
    };
    procurar();
    return () => {
      cancelado = true;
    };
  }, [ativo, indice, passo.alvo, passo.esperarMs, irPara]);

  // O alvo pode mexer (a lista carrega, o painel abre, a janela muda de
  // tamanho): o holofote acompanha.
  useEffect(() => {
    if (!ativo) return;
    const medir = () => {
      setTela({ width: window.innerWidth, height: window.innerHeight });
      const el = alvoRef.current;
      if (!el || !el.isConnected) return;
      const nova = caixaDe(el);
      setCaixa((atual) =>
        atual &&
        Math.abs(atual.top - nova.top) < 1 &&
        Math.abs(atual.left - nova.left) < 1 &&
        Math.abs(atual.width - nova.width) < 1 &&
        Math.abs(atual.height - nova.height) < 1
          ? atual
          : nova,
      );
    };
    medir();
    const timer = setInterval(medir, 200);
    window.addEventListener("resize", medir);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", medir);
    };
  }, [ativo]);

  // A altura do cartão muda de passo pra passo (texto maior, dica de
  // clique): medida depois de desenhar, pra o cartão caber na tela.
  useLayoutEffect(() => {
    if (!ativo || !cartaoRef.current) return;
    const altura = cartaoRef.current.offsetHeight;
    if (altura && altura !== alturaDoCartao) setAlturaDoCartao(altura);
  }, [ativo, indice, caixa, alturaDoCartao]);

  // Passo de clicar: o clique de verdade no alvo leva adiante — depois de
  // o painel reagir a ele (a conversa abrir).
  useEffect(() => {
    if (!ativo || !passo.clicar) return;
    const aoClicar = (evento: MouseEvent) => {
      const el = alvoRef.current;
      if (el && evento.target instanceof Node && el.contains(evento.target)) {
        setTimeout(() => irPara(1), 450);
      }
    };
    document.addEventListener("click", aoClicar, true);
    return () => document.removeEventListener("click", aoClicar, true);
  }, [ativo, passo.clicar, irPara]);

  // Teclado: Esc sai; setas andam. Fora de campo de texto, pra não roubar
  // a seta de quem está digitando.
  useEffect(() => {
    if (!ativo) return;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        evento.preventDefault();
        encerrar("pulado");
        return;
      }
      const alvo = evento.target as HTMLElement | null;
      if (alvo?.closest("input, textarea, [contenteditable=true]")) return;
      if (evento.key === "ArrowRight") irPara(1);
      if (evento.key === "ArrowLeft" && indice > 0) irPara(-1);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [ativo, indice, irPara, encerrar]);

  if (!ativo) return null;

  const centro = !passo.alvo || !caixa;
  const largura = passo.id === "boas-vindas" || passo.id === "fim" ? 440 : 340;
  const posicao = posicionarCartao(centro ? null : caixa, tela, {
    width: largura,
    height: alturaDoCartao,
  });
  const holofote: Caixa = centro
    ? { top: tela.height / 2, left: tela.width / 2, width: 0, height: 0 }
    : (caixa as Caixa);
  const numero = indice; // o passo 1 é o primeiro depois das boas-vindas

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-label="Tour do painel"
    >
      {/* O escuro em volta é a sombra do holofote. */}
      <div
        className="tour-holofote pointer-events-none absolute rounded-xl"
        style={{
          top: holofote.top,
          left: holofote.left,
          width: holofote.width,
          height: holofote.height,
          boxShadow: `0 0 0 9999px oklch(0 0 0 / ${centro ? 72 : 62}%)`,
        }}
      >
        {centro ? null : (
          <span
            className="tour-pulso absolute inset-0 rounded-xl ring-2 ring-primary"
            aria-hidden
          />
        )}
      </div>

      {/* O que bloqueia o resto da tela. No passo de clicar, o buraco do
          holofote fica livre pra receber o clique de verdade. */}
      {passo.clicar && caixa ? (
        <>
          <div
            className="pointer-events-auto absolute inset-x-0 top-0"
            style={{ height: Math.max(caixa.top, 0) }}
          />
          <div
            className="pointer-events-auto absolute inset-x-0 bottom-0"
            style={{ top: caixa.top + caixa.height }}
          />
          <div
            className="pointer-events-auto absolute left-0"
            style={{
              top: caixa.top,
              height: caixa.height,
              width: Math.max(caixa.left, 0),
            }}
          />
          <div
            className="pointer-events-auto absolute right-0"
            style={{
              top: caixa.top,
              height: caixa.height,
              left: caixa.left + caixa.width,
            }}
          />
        </>
      ) : (
        <div className="pointer-events-auto absolute inset-0" />
      )}

      {passo.id === "fim" ? <Confetes /> : null}

      <div
        ref={cartaoRef}
        key={passo.id}
        className="cadastro-entra pointer-events-auto absolute overflow-hidden rounded-2xl bg-neutral-950 text-white shadow-[0_30px_80px_-20px_oklch(0_0_0/70%)] ring-1 ring-white/10 transition-[top,left] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ top: posicao.top, left: posicao.left, width: largura }}
      >
        {passo.id === "boas-vindas" ? (
          <div className="flex flex-col gap-6 p-7">
            <span className="relative flex size-14 items-center justify-center">
              <span className="tour-pulso absolute inset-0 rounded-2xl" />
              <span className="flex size-14 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
                <Marca className="size-8" />
              </span>
            </span>
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-semibold tracking-tight text-balance">
                {nome ? `Boas-vindas, ${nome}!` : "Boas-vindas!"}
              </h2>
              <p className="text-[15px] leading-relaxed text-white/70 text-pretty">
                Em um minuto você conhece o essencial do painel: onde as
                conversas chegam, como responder e onde a IA se configura. Dá
                pra pular quando quiser.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => irPara(1)}
                autoFocus
                className="group inline-flex h-11 items-center gap-2 rounded-full bg-primary pr-4 pl-5 text-sm font-semibold text-neutral-950 transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                Começar o tour
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <button
                type="button"
                onClick={() => encerrar("pulado")}
                className="h-11 rounded-full px-4 text-sm font-medium text-white/60 transition-colors hover:text-white"
              >
                Agora não
              </button>
            </div>
          </div>
        ) : passo.id === "fim" ? (
          <div className="flex flex-col gap-6 p-7">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-neutral-950">
              <PartyPopper className="size-7" />
            </span>
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-semibold tracking-tight text-balance">
                {nome ? `Pronto, ${nome}!` : "Pronto!"} Você já sabe o caminho.
              </h2>
              <p className="text-[15px] leading-relaxed text-white/70 text-pretty">
                {canal && canal.estado !== "CONECTADO"
                  ? "Falta só conectar o WhatsApp da empresa — leva menos de um minuto, pelo QR code."
                  : "Agora é com você. Se precisar, o assistente no canto da tela está sempre por perto."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {canal && canal.estado !== "CONECTADO" ? (
                <Link
                  href="/dashboard/settings/whatsapp"
                  onClick={() => encerrar("concluido")}
                  className="group inline-flex h-11 items-center gap-2 rounded-full bg-primary pr-4 pl-5 text-sm font-semibold text-neutral-950 transition-transform hover:scale-[1.02]"
                >
                  Conectar o WhatsApp
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => encerrar("concluido")}
                autoFocus
                className={cn(
                  "h-11 rounded-full text-sm font-semibold transition-transform",
                  canal && canal.estado !== "CONECTADO"
                    ? "px-4 font-medium text-white/60 hover:text-white"
                    : "bg-primary px-6 text-neutral-950 hover:scale-[1.02]",
                )}
              >
                {canal && canal.estado !== "CONECTADO"
                  ? "Depois"
                  : "Começar a atender"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="flex flex-col gap-3 p-5 pb-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
                  {numero} de {PERGUNTAS}
                </span>
                <button
                  type="button"
                  onClick={() => encerrar("pulado")}
                  className="-mr-1 flex items-center gap-1 rounded-full px-2 py-1 text-xs text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Pular tour
                  <X className="size-3.5" />
                </button>
              </div>
              <h2 className="text-lg leading-snug font-semibold tracking-tight">
                {passo.titulo}
              </h2>
              <p className="text-sm leading-relaxed text-white/70 text-pretty">
                {passo.texto}
              </p>
              {passo.clicar ? (
                <p className="flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
                  <MousePointerClick className="tour-dedo size-4 shrink-0" />
                  {passo.clicar}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-3 border-t border-white/10 px-5 py-3">
              {/* A barra do progresso: o quanto falta, sem número pra ler. */}
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${(numero / PERGUNTAS) * 100}%` }}
                />
              </div>
              <button
                type="button"
                onClick={() => irPara(-1)}
                aria-label="Passo anterior"
                className="flex size-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ArrowLeft className="size-4" />
              </button>
              {passo.clicar ? (
                <button
                  type="button"
                  onClick={() => irPara(1)}
                  className="h-8 rounded-full px-3 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Pular etapa
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => irPara(1)}
                  autoFocus
                  className="group inline-flex h-8 items-center gap-1.5 rounded-full bg-white pr-3 pl-4 text-xs font-semibold text-neutral-950 transition-colors hover:bg-primary"
                >
                  Próximo
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Uma chuva curta de papel picado, nas cores da marca. */
function Confetes() {
  const cores = [
    "bg-primary",
    "bg-white",
    "bg-emerald-300",
    "bg-neutral-400",
    "bg-primary",
  ];
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {Array.from({ length: 70 }, (_, i) => {
        // Pseudoaleatório pelo índice: a mesma chuva a cada vez, sem
        // Math.random em render.
        const semente = (i * 9301 + 49297) % 233280;
        const frac = semente / 233280;
        const frac2 = ((i * 7919) % 1000) / 1000;
        return (
          <span
            key={i}
            className={cn(
              "tour-confete absolute top-0 block rounded-[1px]",
              cores[i % cores.length],
              i % 3 === 0
                ? "h-2.5 w-1.5"
                : i % 3 === 1
                  ? "size-2"
                  : "h-1.5 w-3",
            )}
            style={
              {
                left: `${frac * 100}%`,
                animationDelay: `${frac2 * 0.9}s`,
                "--x": `${(frac2 - 0.5) * 220}px`,
                "--r": `${360 + frac * 720}deg`,
                "--d": `${2.2 + frac2 * 1.6}s`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
