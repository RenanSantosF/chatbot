"use client";

import { Check, Plus, Tag as TagIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Tag } from "@/lib/types";

/**
 * Cada tom, nos dois temas.
 *
 * O banco guarda o NOME da cor, e a tradução pra pixel mora aqui: um
 * hexadecimal escolhido pelo dono no tema claro ficaria ilegível no escuro,
 * e quem escolheu não usa os dois pra descobrir. São tons de fundo suave
 * com texto forte, e não pílulas chapadas — a etiqueta acompanha a
 * conversa, não disputa com ela.
 */
export const TONS: Record<string, string> = {
  cinza: "bg-muted text-muted-foreground",
  vermelho: "bg-red-500/12 text-red-700 dark:text-red-300",
  ambar: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  verde: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  azul: "bg-blue-500/12 text-blue-700 dark:text-blue-300",
  roxo: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  rosa: "bg-pink-500/12 text-pink-700 dark:text-pink-300",
  ciano: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300",
};

export const CORES = Object.keys(TONS);

export function tomDa(cor: string): string {
  return TONS[cor] ?? TONS.cinza;
}

/** A pastilha da etiqueta, do tamanho de um rótulo e não de um botão. */
export function TagChip({
  tag,
  className,
}: {
  tag: Tag;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] leading-tight font-medium",
        tomDa(tag.color),
        className,
      )}
    >
      {tag.name}
    </span>
  );
}

/**
 * Escolher e criar etiquetas sem sair da conversa.
 *
 * Criar é livre pra quem atende de propósito (ver TagsController na API):
 * quem está com a conversa aberta é justamente quem percebe que "Segunda
 * via" se repete o dia inteiro. Mandar essa pessoa abrir Configurações,
 * cadastrar e voltar garante que a etiqueta não é criada — e o recurso
 * morre de burocracia antes da primeira semana.
 */
export function TagPicker({
  selecionadas,
  onMarcar,
  onDesmarcar,
}: {
  selecionadas: Tag[];
  onMarcar: (tag: Tag) => Promise<void>;
  onDesmarcar: (tag: Tag) => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [todas, setTodas] = useState<Tag[] | null>(null);
  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Mesma mecânica do seletor de emojis: clique fora e Esc fecham. Um
  // popover de biblioteca traria dependência nova pra resolver o que já
  // está resolvido do lado, e de um jeito que a equipe já conhece.
  useEffect(() => {
    if (!aberto) return;

    const foraDaqui = (evento: MouseEvent) => {
      if (!containerRef.current?.contains(evento.target as Node)) setAberto(false);
    };
    const noEsc = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        // Impede que o Esc suba pro painel e feche a conversa junto.
        evento.stopPropagation();
        setAberto(false);
      }
    };

    document.addEventListener("mousedown", foraDaqui);
    document.addEventListener("keydown", noEsc, true);
    return () => {
      document.removeEventListener("mousedown", foraDaqui);
      document.removeEventListener("keydown", noEsc, true);
    };
  }, [aberto]);

  useEffect(() => {
    if (!aberto || todas !== null) return;
    apiFetch<Tag[]>("/tags")
      .then(setTodas)
      .catch(() => setTodas([]));
  }, [aberto, todas]);

  const termo = busca.trim();
  const visiveis = (todas ?? []).filter((tag) =>
    tag.name.toLowerCase().includes(termo.toLowerCase()),
  );
  // Só oferece criar quando o nome digitado não existe ainda — igual ao
  // servidor, que recusa nome repetido.
  const podeCriar =
    termo.length > 0 &&
    !(todas ?? []).some(
      (tag) => tag.name.toLowerCase() === termo.toLowerCase(),
    );

  const marcadas = new Set(selecionadas.map((tag) => tag.id));

  async function criar() {
    setCriando(true);
    try {
      const nova = await apiFetch<Tag>("/tags", {
        method: "POST",
        body: JSON.stringify({ name: termo }),
      });
      setTodas((atuais) => [...(atuais ?? []), nova]);
      setBusca("");
      await onMarcar(nova);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não deu pra criar.");
    } finally {
      setCriando(false);
    }
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Etiquetas da conversa"
        aria-expanded={aberto}
        title="Etiquetas"
        onClick={() => setAberto((estava) => !estava)}
        className={cn(aberto && "text-primary")}
      >
        <TagIcon className="size-4" />
      </Button>

      {aberto ? (
        <div
          role="dialog"
          aria-label="Escolher etiquetas"
          // Ancorado à direita e pra baixo: o botão vive no cabeçalho da
          // conversa, no canto direito.
          className="absolute top-full right-0 z-30 mt-2 w-64 rounded-xl bg-popover p-2 shadow-[0_8px_28px_oklch(0_0_0/20%)] duration-150 animate-in fade-in slide-in-from-top-1"
        >
        <Input
          value={busca}
          onChange={(evento) => setBusca(evento.target.value)}
          placeholder="Buscar ou criar…"
          className="h-8"
          onKeyDown={(evento) => {
            if (evento.key === "Enter" && podeCriar) {
              evento.preventDefault();
              void criar();
            }
          }}
        />

        <div className="mt-1.5 max-h-56 overflow-y-auto">
          {todas === null ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">Carregando…</p>
          ) : visiveis.length === 0 && !podeCriar ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              Nenhuma etiqueta ainda. Escreva um nome pra criar a primeira.
            </p>
          ) : (
            visiveis.map((tag) => {
              const marcada = marcadas.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => void (marcada ? onDesmarcar(tag) : onMarcar(tag))}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent"
                >
                  <Check
                    className={cn("size-3.5 shrink-0", !marcada && "invisible")}
                  />
                  <TagChip tag={tag} />
                </button>
              );
            })
          )}
        </div>

        {podeCriar ? (
          <Button
            size="sm"
            variant="ghost"
            className="mt-1 w-full justify-start text-xs"
            disabled={criando}
            onClick={() => void criar()}
          >
            <Plus className="size-3.5" />
            Criar &ldquo;{termo}&rdquo;
          </Button>
        ) : null}
        </div>
      ) : null}
    </div>
  );
}
