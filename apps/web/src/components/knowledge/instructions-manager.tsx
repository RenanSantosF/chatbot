"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import type { AiInstruction } from "@/lib/types";

/**
 * As regras que a empresa ensina à IA.
 *
 * MUDOU DE LUGAR: vivia em Configurações > IA, no meio de chave de API,
 * modelo, memória e ferramentas — coisas que se mexe uma vez e esquece.
 * Isto aqui é o oposto: é conteúdo, escrito e reescrito conforme o negócio
 * muda, e pertence ao lado do acervo de documentos. Quem vai escrever uma
 * regra está pensando "o que a IA precisa saber", não "como a IA está
 * configurada".
 *
 * O FORMULÁRIO SÓ APARECE QUANDO SE QUER ESCREVER. Antes ele ficava
 * permanentemente aberto numa caixa tracejada acima da lista, com dois
 * campos vazios e um botão desligado — o primeiro que se via ao entrar era
 * um formulário em branco, e as regras que já existem, que são o conteúdo
 * da tela, começavam abaixo dele. Agora o padrão é a lista, e escrever é
 * um clique.
 */
export function InstructionsManager({
  instructions,
  onChange,
}: {
  instructions: AiInstruction[];
  onChange: (instructions: AiInstruction[]) => void;
}) {
  const [escrevendo, setEscrevendo] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [creating, setCreating] = useState(false);

  function fechar() {
    setEscrevendo(false);
    setTitle("");
    setContent("");
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setCreating(true);
    try {
      const created = await apiFetch<AiInstruction>("/ai/instructions", {
        method: "POST",
        body: JSON.stringify({ title, content }),
      });
      onChange([created, ...instructions]);
      fechar();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não deu pra criar a regra.");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(instruction: AiInstruction) {
    try {
      const updated = await apiFetch<AiInstruction>(`/ai/instructions/${instruction.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !instruction.active }),
      });
      onChange(instructions.map((item) => (item.id === updated.id ? updated : item)));
    } catch {
      toast.error("Não deu pra atualizar a regra.");
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiFetch(`/ai/instructions/${id}`, { method: "DELETE" });
      onChange(instructions.filter((item) => item.id !== id));
    } catch {
      toast.error("Não deu pra remover a regra.");
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">O que a IA precisa saber</h2>
          <p className="text-sm text-muted-foreground text-pretty">
            Escreva como explicaria pra um funcionário novo.
          </p>
        </div>
        {!escrevendo ? (
          <Button size="sm" variant="outline" onClick={() => setEscrevendo(true)}>
            <Plus className="size-4" />
            Nova regra
          </Button>
        ) : null}
      </div>

      {/* Abre no lugar do botão, com o cursor já no primeiro campo: quem
          clicou em "nova regra" quer digitar, não procurar onde digitar. */}
      {escrevendo ? (
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-3 rounded-xl border bg-card p-4 duration-200 animate-in fade-in slide-in-from-top-1"
        >
          <Input
            autoFocus
            aria-label="Assunto da regra"
            placeholder="Assunto — ex.: Valor da consulta"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            // `dark:bg-transparent` junto: o Input traz um `dark:bg-input/30` que
            // o `bg-transparent` sozinho não vence, e o campo aparecia como
            // uma caixa dentro da caixa do formulário.
            className="h-auto border-0 bg-transparent p-0 text-[15px] font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Textarea
            aria-label="O que a IA deve saber ou fazer"
            rows={3}
            placeholder="Ex.: quando perguntarem o valor da consulta, informe que custa R$ 300 e pode ser presencial ou online."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center justify-end gap-2 border-t pt-3">
            <Button type="button" size="sm" variant="ghost" onClick={fechar}>
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={creating || !title.trim() || !content.trim()}
            >
              {creating ? "Salvando..." : "Salvar regra"}
            </Button>
          </div>
        </form>
      ) : null}

      {instructions.length === 0 && !escrevendo ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground text-pretty">
          Nenhuma regra ainda. A primeira costuma ser o horário de
          funcionamento ou o preço do que você vende.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {instructions.map((instruction) => (
            <li
              key={instruction.id}
              className={cn(
                "group flex items-start gap-3 rounded-xl border bg-card px-4 py-3 transition-colors",
                // Desligada continua à vista, e apagada: sumir com ela
                // faria parecer que foi removida, e o interruptor existe
                // justamente pra guardar uma regra sem usá-la agora.
                !instruction.active && "opacity-55",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{instruction.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground text-pretty">
                  {instruction.content}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Switch
                  checked={instruction.active}
                  onCheckedChange={() => handleToggle(instruction)}
                  aria-label={instruction.active ? "Desativar regra" : "Ativar regra"}
                  title={instruction.active ? "Desativar" : "Ativar"}
                />
                {/* Aparece no hover, e sempre em quem navega por teclado:
                    remover é o único botão irreversível da linha, e um
                    ícone de lixeira permanente ao lado de cada regra
                    convida ao acidente. */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(instruction.id)}
                  aria-label={`Remover ${instruction.title}`}
                  title="Remover"
                  className="size-8 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
