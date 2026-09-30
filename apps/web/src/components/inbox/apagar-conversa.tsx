"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/components/session-provider";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

/**
 * Apagar a conversa inteira do painel — discreto, no pé da ficha.
 *
 * Só dono e admin, e com confirmação: é histórico de atendimento, com os
 * anexos juntos, e não volta. No celular do cliente nada muda. Quando dá
 * certo, a conversa some das telas pelo tempo real (`conversation.deleted`).
 */
export function ApagarConversa({ conversationId, nome }: { conversationId: string; nome: string }) {
  const { user } = useSession();
  const [aberto, setAberto] = useState(false);
  const [apagando, setApagando] = useState(false);

  if (user.role !== "OWNER" && user.role !== "ADMIN") return null;

  async function apagar() {
    setApagando(true);
    try {
      await apiFetch(`/conversations/${conversationId}`, { method: "DELETE" });
      toast.success("Conversa apagada.");
    } catch (erro) {
      toast.error(erro instanceof ApiError ? erro.message : "Não deu pra apagar a conversa.");
      setApagando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="self-start text-xs text-muted-foreground/70 underline-offset-4 transition-colors hover:text-muted-foreground hover:underline"
      >
        Apagar esta conversa
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-xs">
      <p className="text-muted-foreground text-pretty">
        Apaga do painel toda a conversa com <strong className="text-foreground">{nome}</strong>,
        com fotos e documentos guardados. Não tem como desfazer. No celular do cliente nada muda.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={apagando} onClick={() => setAberto(false)}>
          Cancelar
        </Button>
        <Button size="sm" variant="destructive" disabled={apagando} onClick={() => void apagar()}>
          {apagando ? <Spinner className="size-3.5" /> : null}
          Apagar conversa
        </Button>
      </div>
    </div>
  );
}
