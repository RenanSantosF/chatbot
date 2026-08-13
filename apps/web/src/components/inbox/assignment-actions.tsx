"use client";

import { Check, UserPlus, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { Assignable, ConversationDetail, Queue } from "@/lib/types";

/**
 * Ações de responsabilidade da conversa. Três estados, nunca dois ao mesmo
 * tempo:
 *
 * - sem dono            -> Assumir
 * - indicada a mim      -> Aceitar / Recusar
 * - já é minha (ou de   -> Transferir
 *   outra pessoa)
 *
 * Antes o botão "Assumir" continuava lá depois de assumir, o que fazia a
 * pessoa clicar de novo achando que não tinha funcionado.
 */
export function AssignmentActions({
  conversation,
  currentUserId,
  onChanged,
}: {
  conversation: ConversationDetail;
  currentUserId: string;
  onChanged: () => void;
}) {
  const [abrindo, setAbrindo] = useState(false);
  const [equipe, setEquipe] = useState<Assignable[]>([]);
  const [setores, setSetores] = useState<Queue[]>([]);
  // "Pra quem" tem duas naturezas: uma pessoa ou um setor inteiro. Um estado
  // só, com prefixo, evita o caso impossível de os dois estarem escolhidos.
  const [destino, setDestino] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const meu = conversation.assignedUser?.id === currentUserId;
  const indicadaParaMim = meu && !conversation.assignmentAccepted;

  useEffect(() => {
    if (!abrindo || equipe.length > 0) return;
    // `/users/assignable`, não `/users`: a lista completa da equipe é
    // restrita a dono e admin, e transferir conversa é trabalho de quem
    // atende.
    Promise.all([
      apiFetch<Assignable[]>("/users/assignable"),
      apiFetch<Queue[]>("/queues").catch(() => [] as Queue[]),
    ])
      .then(([lista, filas]) => {
        const outros = lista.filter((u) => u.id !== conversation.assignedUser?.id);
        setEquipe(outros);
        setSetores(filas);
        setDestino(filas[0] ? `setor:${filas[0].id}` : (outros[0] ? `pessoa:${outros[0].id}` : ""));
      })
      .catch(() => toast.error("Não deu pra carregar a equipe."));
  }, [abrindo, equipe.length, conversation.assignedUser?.id]);

  async function chamar(caminho: string, body?: Record<string, unknown>) {
    setOcupado(true);
    try {
      await apiFetch(`/conversations/${conversation.id}/${caminho}`, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      onChanged();
      setAbrindo(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não deu certo.");
    } finally {
      setOcupado(false);
    }
  }

  if (indicadaParaMim) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="hidden text-xs text-muted-foreground xl:inline">
          Indicada a você
        </span>
        <Button size="sm" disabled={ocupado} onClick={() => void chamar("accept")}>
          <Check className="size-4" />
          Aceitar
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={ocupado}
          onClick={() => void chamar("decline")}
        >
          <X className="size-4" />
          Recusar
        </Button>
      </div>
    );
  }

  return (
    <>
      {conversation.assignedUser ? (
        <Button size="sm" variant="outline" onClick={() => setAbrindo(true)}>
          <Users className="size-4" />
          Transferir
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void chamar("assign")}>
          <UserPlus className="size-4" />
          Assumir
        </Button>
      )}

      <Sheet open={abrindo} onOpenChange={setAbrindo}>
        <SheetContent className="gap-0">
          <SheetHeader>
            <SheetTitle>Transferir atendimento</SheetTitle>
            <SheetDescription>
              Escolha um setor, quando qualquer pessoa dele resolve, ou uma pessoa, quando o caso é
              dela.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 px-4 py-2">
            {equipe.length === 0 && setores.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Não há setores nem colaboradores ativos para receber esta conversa.
              </p>
            ) : (
              <SelectField
                label="Para quem"
                value={destino}
                onChange={setDestino}
                options={[
                  ...setores.map((f) => ({ value: `setor:${f.id}`, label: `Setor · ${f.name}` })),
                  ...equipe.map((u) => ({ value: `pessoa:${u.id}`, label: u.name })),
                ]}
              />
            )}

            <p className="text-xs text-muted-foreground text-pretty">
              {destino.startsWith("setor:")
                ? "A conversa fica disponível para o setor inteiro e quem estiver livre assume — não fica presa esperando uma pessoa específica."
                : "A pessoa escolhida recebe como indicação e confirma antes de virar responsável."}
            </p>

            <SheetFooter className="px-0">
              <Button
                disabled={ocupado || !destino}
                onClick={() => {
                  const [tipo, id] = destino.split(":");
                  void (tipo === "setor"
                    ? chamar("transfer-queue", { queueId: id })
                    : chamar("transfer", { toUserId: id }));
                }}
              >
                Transferir
              </Button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
