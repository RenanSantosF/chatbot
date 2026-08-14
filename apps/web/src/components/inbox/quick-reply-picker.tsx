"use client";

import { Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { QuickReply } from "@/lib/types";

/**
 * A barra abre o seletor; o resto do que se digita filtra.
 *
 * Só vale no COMEÇO do rascunho: uma barra no meio de uma frase é uma
 * barra ("3/4", "e/ou"), e abrir uma lista ali seria atrapalhar quem
 * escreve pra ajudar quem não pediu ajuda.
 */
export function termoDoAtalho(rascunho: string): string | null {
  const encontrado = /^\/([^\s]*)$/.exec(rascunho);
  return encontrado ? encontrado[1].toLowerCase() : null;
}

/** Sem título cadastrado, a primeira linha do texto serve de rótulo. */
export function rotulo(resposta: QuickReply): string {
  if (resposta.title) return resposta.title;
  const [primeira] = resposta.content.split("\n");
  return primeira.length > 60 ? `${primeira.slice(0, 60)}…` : primeira;
}

export function filtrar(respostas: QuickReply[], termo: string): QuickReply[] {
  if (!termo) return respostas;
  // Atalho na frente, título depois: quem digita "/pix" quer a resposta de
  // atalho "pix", mesmo que outra tenha "PIX" no meio do título.
  const porAtalho = respostas.filter((item) => item.shortcut.includes(termo));
  const porTitulo = respostas.filter(
    (item) =>
      !item.shortcut.includes(termo) &&
      rotulo(item).toLowerCase().includes(termo),
  );
  return [...porAtalho, ...porTitulo];
}

/**
 * O seletor de respostas rápidas, ancorado acima do compositor.
 *
 * Discreto por construção: não existe botão, não ocupa espaço e ninguém
 * precisa saber que ele existe pra usar o painel. Quem descobre a barra
 * ganha velocidade; quem não descobre não perde nada.
 */
export function QuickReplyPicker({
  termo,
  onEscolher,
}: {
  /** O que veio depois da barra. `null` mantém o seletor fechado. */
  termo: string | null;
  onEscolher: (resposta: QuickReply) => void;
}) {
  const [respostas, setRespostas] = useState<QuickReply[] | null>(null);
  /**
   * A linha escolhida, junto com o termo a que ela pertence.
   *
   * Guardar os dois evita o efeito que zerava o índice quando o filtro
   * mudava: com o termo dentro do estado, um filtro novo simplesmente não
   * casa e a escolha volta ao topo por conta própria — sem um segundo
   * quadro em que a seta apontava pra uma linha que já tinha saído.
   */
  const [escolha, setEscolha] = useState({ termo: "", indice: 0 });
  const listaRef = useRef<HTMLDivElement | null>(null);

  const aberto = termo !== null;

  // Carregado na primeira barra digitada, e não na montagem do painel:
  // quem nunca usa o recurso não paga uma requisição por conversa aberta.
  useEffect(() => {
    if (!aberto || respostas !== null) return;
    apiFetch<QuickReply[]>("/quick-replies")
      .then(setRespostas)
      .catch(() => setRespostas([]));
  }, [aberto, respostas]);

  // Memorizado porque o efeito do teclado depende dele: sem isto a lista
  // seria um array novo a cada render e o ouvinte se refaria em todos.
  const visiveis = useMemo(
    () => (aberto ? filtrar(respostas ?? [], termo) : []),
    [aberto, respostas, termo],
  );
  const ativo = escolha.termo === (termo ?? "") ? escolha.indice : 0;

  const escolher = useCallback(
    (indice: number) => setEscolha({ termo: termo ?? "", indice }),
    [termo],
  );

  useEffect(() => {
    if (!aberto || visiveis.length === 0) return;

    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
        evento.preventDefault();
        const passo = evento.key === "ArrowDown" ? 1 : -1;
        escolher((ativo + passo + visiveis.length) % visiveis.length);
        return;
      }
      // Enter e Tab escolhem. O Enter precisa ser interceptado na fase de
      // captura: o compositor também escuta Enter, e sem isto a mensagem
      // sairia com o texto "/pix" cru.
      if (evento.key === "Enter" || evento.key === "Tab") {
        evento.preventDefault();
        evento.stopPropagation();
        onEscolher(visiveis[ativo]);
      }
    };

    window.addEventListener("keydown", aoTeclar, true);
    return () => window.removeEventListener("keydown", aoTeclar, true);
  }, [aberto, visiveis, ativo, escolher, onEscolher]);

  // Mantém a linha escolhida à vista quando a seta passa do fim da lista.
  useEffect(() => {
    listaRef.current?.children[ativo]?.scrollIntoView({ block: "nearest" });
  }, [ativo]);

  if (!aberto) return null;

  return (
    <div className="border-t bg-card px-3 pt-2">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Zap className="size-3" />
        Respostas rápidas
        <span className="ml-auto">↑↓ escolher · Enter usar · Esc sair</span>
      </div>

      {respostas === null ? (
        <p className="pb-2 text-xs text-muted-foreground">Carregando…</p>
      ) : visiveis.length === 0 ? (
        <p className="pb-2 text-xs text-muted-foreground">
          {respostas.length === 0
            ? "Nenhuma resposta rápida cadastrada ainda — configure em Ajustes › Atendimento."
            : "Nenhuma resposta com esse atalho."}
        </p>
      ) : (
        <div ref={listaRef} className="max-h-56 overflow-y-auto pb-2">
          {visiveis.map((resposta, indice) => (
            <button
              key={resposta.id}
              type="button"
              // `onMouseDown` e não `onClick`: clicar tira o foco do
              // compositor antes do clique terminar, e o seletor fecharia
              // sozinho no caminho.
              onMouseDown={(evento) => {
                evento.preventDefault();
                onEscolher(resposta);
              }}
              onMouseEnter={() => escolher(indice)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
                indice === ativo ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              <span className="flex items-center gap-2 text-xs font-medium">
                <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                  /{resposta.shortcut}
                </span>
                {rotulo(resposta)}
              </span>
              <span className="line-clamp-1 text-[11px] text-muted-foreground">
                {resposta.content}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
