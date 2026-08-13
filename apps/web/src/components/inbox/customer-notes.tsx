"use client";

import { Check, Plus, StickyNote, Trash2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { CustomerNote } from "@/lib/types";

function quando(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/**
 * Anotações e pendências da ficha do cliente.
 *
 * Discreto de propósito: fechado é uma linha só com a contagem. Isto é
 * memória do atendimento ("Nilma Transportes, aguardando prazo de coleta"),
 * não algo que deva competir com a conversa — quem precisa, abre.
 */
export function CustomerNotes({ customerId }: { customerId: string }) {
  const [notas, setNotas] = useState<CustomerNote[] | null>(null);
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [pendencia, setPendencia] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Sem reset de estado aqui: quem troca de cliente remonta o componente
  // (key={customer.id} no painel), então este efeito só busca — zerar
  // `notas` e `aberto` na mão seria refazer o que a remontagem já faz.
  useEffect(() => {
    apiFetch<CustomerNote[]>(`/customers/${customerId}/notes`)
      .then(setNotas)
      .catch(() => setNotas([]));
  }, [customerId]);

  const emAberto = (notas ?? []).filter((n) => n.isPending && !n.doneAt);

  async function criar() {
    const texto = rascunho.trim();
    if (!texto) return;
    setSalvando(true);
    try {
      const nova = await apiFetch<CustomerNote>(`/customers/${customerId}/notes`, {
        method: "POST",
        body: JSON.stringify({ content: texto, isPending: pendencia }),
      });
      setNotas((atuais) => [nova, ...(atuais ?? [])]);
      setRascunho("");
    } catch {
      toast.error("Não deu pra salvar a anotação.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternarConcluida(nota: CustomerNote) {
    try {
      const atualizada = await apiFetch<CustomerNote>(`/customers/notes/${nota.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !nota.doneAt }),
      });
      setNotas((atuais) => (atuais ?? []).map((n) => (n.id === nota.id ? atualizada : n)));
    } catch {
      toast.error("Não deu pra atualizar.");
    }
  }

  async function apagar(id: string) {
    try {
      await apiFetch(`/customers/notes/${id}`, { method: "DELETE" });
      setNotas((atuais) => (atuais ?? []).filter((n) => n.id !== id));
    } catch {
      toast.error("Não deu pra apagar.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <StickyNote className="size-3.5" />
          Anotações
        </span>
        {emAberto.length > 0 ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            {emAberto.length} pendente{emAberto.length > 1 ? "s" : ""}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">{notas?.length ?? 0}</span>
        )}
      </button>

      {aberto ? (
        <div className="flex flex-col gap-2">
          <Textarea
            rows={2}
            value={rascunho}
            onChange={(event) => setRascunho(event.target.value)}
            placeholder="Ex.: aguardando prazo de coleta das informações"
            maxLength={2000}
            className="text-xs"
          />
          <div className="flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={pendencia}
                onChange={(event) => setPendencia(event.target.checked)}
                className="size-3.5 accent-primary"
              />
              É uma pendência
            </label>
            <Button size="sm" disabled={salvando || !rascunho.trim()} onClick={() => void criar()}>
              {salvando ? <Spinner /> : <Plus className="size-3.5" />}
              Anotar
            </Button>
          </div>

          {notas === null ? (
            <p className="text-xs text-muted-foreground">Carregando…</p>
          ) : notas.length === 0 ? (
            <p className="text-xs text-muted-foreground text-pretty">
              Nada anotado ainda. O que ficar registrado aqui aparece pra quem pegar a próxima
              conversa deste cliente.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {notas.map((nota) => (
                <li
                  key={nota.id}
                  className={cn(
                    "group/nota rounded-md px-2 py-1.5 text-xs",
                    nota.isPending && !nota.doneAt
                      ? "bg-amber-500/10"
                      : "bg-muted/50 text-muted-foreground",
                  )}
                >
                  <p className={cn("break-words", nota.doneAt && "line-through opacity-70")}>
                    {nota.content}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">
                      {nota.author?.name ?? "—"} · {quando(nota.createdAt)}
                    </span>
                    <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/nota:opacity-100 focus-within:opacity-100">
                      {nota.isPending ? (
                        <button
                          type="button"
                          title={nota.doneAt ? "Reabrir" : "Marcar como resolvida"}
                          onClick={() => void alternarConcluida(nota)}
                          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          {nota.doneAt ? (
                            <Undo2 className="size-3.5" />
                          ) : (
                            <Check className="size-3.5" />
                          )}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        title="Apagar anotação"
                        onClick={() => void apagar(nota.id)}
                        className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
