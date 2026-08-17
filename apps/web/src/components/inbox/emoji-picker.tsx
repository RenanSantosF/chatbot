"use client";

import { Search, Smile, Sticker } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { buscarEmojis, GRUPOS_DE_EMOJIS } from "@/lib/emojis";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Onde os últimos usados ficam entre uma sessão e outra. */
const CHAVE_RECENTES = "inbox-emojis-recentes";
const MAXIMO_RECENTES = 16;

function lerRecentes(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const bruto = window.localStorage.getItem(CHAVE_RECENTES);
    const lista: unknown = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista.filter((e) => typeof e === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Carinhas pro compositor. Insere no rascunho em vez de enviar sozinho:
 * emoji quase sempre acompanha texto ("Perfeito 👍"), e um clique que
 * dispara mensagem é fácil de dar sem querer.
 *
 * O painel fica aberto depois do clique, de propósito: quem manda um
 * emoji costuma mandar dois. Fechar a cada escolha obrigava a reabrir.
 */
export function EmojiPicker({
  disabled,
  onPick,
  onPickFigurinha,
}: {
  disabled?: boolean;
  onPick: (emoji: string) => void;
  /**
   * Manda uma figurinha já vista nesta conta. Sem isto, a aba não aparece
   * — é o que mantém o seletor utilizável fora do Inbox.
   */
  onPickFigurinha?: (mediaId: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<"emojis" | "figurinhas">("emojis");
  const [busca, setBusca] = useState("");
  const [recentes, setRecentes] = useState<string[]>([]);
  const [figurinhas, setFigurinhas] = useState<string[] | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Lido na abertura, e não na montagem: localStorage não existe no
  // servidor, e ler a cada render do compositor seria desperdício.
  function abrir() {
    setRecentes(lerRecentes());
    setAberto(true);
  }

  /*
   * A lista de figurinhas só é buscada quando a aba é aberta, e uma vez
   * só por montagem do compositor.
   *
   * Ela varre o histórico de mensagens atrás de WebP, e quem só quer um
   * "👍" não deve pagar por isso — que é a maioria das aberturas do
   * seletor.
   */
  useEffect(() => {
    if (!aberto || aba !== "figurinhas" || figurinhas !== null) return;

    apiFetch<{ mediaId: string }[]>("/whatsapp/media/figurinhas")
      .then((lista) => setFigurinhas(lista.map((item) => item.mediaId)))
      .catch(() => setFigurinhas([]));
  }, [aberto, aba, figurinhas]);

  function escolher(emoji: string) {
    onPick(emoji);
    const novos = [emoji, ...recentes.filter((e) => e !== emoji)].slice(
      0,
      MAXIMO_RECENTES,
    );
    setRecentes(novos);
    try {
      window.localStorage.setItem(CHAVE_RECENTES, JSON.stringify(novos));
    } catch {
      // Navegador com armazenamento bloqueado: os recentes valem só
      // enquanto o painel estiver aberto, e isso já é melhor que nada.
    }
  }

  useEffect(() => {
    if (!aberto) return;

    const foraDaqui = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setAberto(false);
    };
    const noEsc = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Na captura, pra o Esc não fechar a conversa junto do painel de
      // emojis (mesma mecânica do seletor de etiquetas).
      event.stopPropagation();
      setAberto(false);
    };

    document.addEventListener("mousedown", foraDaqui);
    document.addEventListener("keydown", noEsc, true);
    return () => {
      document.removeEventListener("mousedown", foraDaqui);
      document.removeEventListener("keydown", noEsc, true);
    };
  }, [aberto]);

  const resultados = useMemo(() => buscarEmojis(busca), [busca]);
  const procurando = busca.trim().length > 0;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Emojis"
        aria-expanded={aberto}
        title="Emojis"
        disabled={disabled}
        onClick={() => (aberto ? setAberto(false) : abrir())}
        className={cn(aberto && "text-primary")}
      >
        <Smile className="size-4" />
      </Button>

      {aberto ? (
        <div
          role="dialog"
          aria-label="Escolher emoji"
          // bottom-full: o compositor fica colado no rodapé, então a grade
          // só cabe pra cima. Ancorada à esquerda porque o botão vive no
          // canto esquerdo da linha.
          className="absolute bottom-full left-0 z-30 mb-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-popover shadow-[0_8px_28px_oklch(0_0_0/20%)] ring-1 ring-border duration-150 animate-in fade-in slide-in-from-bottom-1"
        >
          {onPickFigurinha ? (
            <div role="tablist" className="flex border-b">
              <Aba
                ativa={aba === "emojis"}
                onClick={() => setAba("emojis")}
                icone={<Smile className="size-4" />}
                rotulo="Emojis"
              />
              <Aba
                ativa={aba === "figurinhas"}
                onClick={() => setAba("figurinhas")}
                icone={<Sticker className="size-4" />}
                rotulo="Figurinhas"
              />
            </div>
          ) : null}

          {aba === "figurinhas" && onPickFigurinha ? (
            <Figurinhas
              lista={figurinhas}
              onPick={(mediaId) => {
                onPickFigurinha(mediaId);
                setAberto(false);
              }}
            />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={busca}
                  onChange={(evento) => setBusca(evento.target.value)}
                  placeholder="Buscar: entrega, café, carro…"
                  aria-label="Buscar emoji"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>

              <div className="flex max-h-64 flex-col gap-2.5 overflow-y-auto p-2.5">
                {procurando ? (
                  resultados.length > 0 ? (
                    <Grade emojis={resultados} onPick={escolher} />
                  ) : (
                    <p className="px-1 py-4 text-center text-xs text-muted-foreground text-pretty">
                      Nenhum emoji com “{busca.trim()}”. Tente outra palavra — a
                      busca entende português.
                    </p>
                  )
                ) : (
                  <>
                    {recentes.length > 0 ? (
                      <Secao titulo="Usados por último">
                        <Grade emojis={recentes} onPick={escolher} />
                      </Secao>
                    ) : null}
                    {GRUPOS_DE_EMOJIS.map((grupo) => (
                      <Secao key={grupo.titulo} titulo={grupo.titulo}>
                        <Grade
                          emojis={grupo.itens.map((item) => item.e)}
                          onPick={escolher}
                        />
                      </Secao>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Aba({
  ativa,
  onClick,
  icone,
  rotulo,
}: {
  ativa: boolean;
  onClick: () => void;
  icone: React.ReactNode;
  rotulo: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-xs font-medium transition-colors",
        ativa
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icone}
      {rotulo}
    </button>
  );
}

/**
 * As figurinhas que já passaram por esta conta.
 *
 * NÃO são os pacotes salvos no celular, e o rodapé diz isso: nem a
 * Evolution nem o Baileys expõem aquela coleção, que vive na
 * sincronização de estado do aplicativo. Prometer uma gaveta que não
 * existe seria pior que explicar o que esta lista é.
 *
 * `null` é "ainda carregando" e `[]` é "não há nenhuma" — são estados
 * diferentes na tela, e juntá-los faria a lista vazia piscar "nenhuma
 * figurinha" antes de a resposta chegar.
 */
function Figurinhas({
  lista,
  onPick,
}: {
  lista: string[] | null;
  onPick: (mediaId: string) => void;
}) {
  if (lista === null) {
    return (
      <p className="px-3 py-8 text-center text-xs text-muted-foreground">
        Carregando…
      </p>
    );
  }

  if (lista.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs text-muted-foreground text-pretty">
        Nenhuma figurinha ainda. As que você mandar ou receber nas conversas
        aparecem aqui pra reenviar com um clique.
      </p>
    );
  }

  return (
    <>
      <div className="grid max-h-64 grid-cols-4 gap-1 overflow-y-auto p-2.5">
        {lista.map((mediaId) => (
          <button
            key={mediaId}
            type="button"
            onClick={() => onPick(mediaId)}
            className="rounded-md p-1 transition-transform hover:scale-110"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/whatsapp/media/${encodeURIComponent(mediaId)}`}
              alt="Figurinha"
              loading="lazy"
              className="aspect-square w-full object-contain"
            />
          </button>
        ))}
      </div>
      <p className="border-t px-3 py-1.5 text-center text-[10px] text-muted-foreground text-pretty">
        As figurinhas das suas conversas. Os pacotes salvos no celular não
        chegam até aqui.
      </p>
    </>
  );
}

function Secao({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {titulo}
      </span>
      {children}
    </div>
  );
}

function Grade({
  emojis,
  onPick,
}: {
  emojis: string[];
  onPick: (emoji: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((emoji) => (
        <button
          key={emoji}
          type="button"
          title={emoji}
          onClick={() => onPick(emoji)}
          className="rounded-md py-1 text-[20px] leading-none transition-transform hover:scale-125"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
