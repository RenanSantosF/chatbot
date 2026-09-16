"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
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

/** Mesmo valor do backend (ver CreateAiInstructionDto) — avisa ANTES do clique em salvar, não só depois. */
const LIMITE_DO_CONTEUDO = 4000;

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
 *
 * EDITAR, E NÃO SÓ APAGAR E REESCREVER. Faltava — a única forma de corrigir
 * um erro de digitação numa regra grande era apagá-la e digitar tudo de
 * novo, o que é exatamente o tipo de atrito que faz uma regra comprida
 * parecer "não dá pra editar isso aqui". O mesmo formulário serve pros dois
 * casos; só troca o verbo do botão e o método da chamada.
 */
export function InstructionsManager({
  instructions,
  onChange,
}: {
  instructions: AiInstruction[];
  onChange: (instructions: AiInstruction[]) => void;
}) {
  /** `null` fechado, `"novo"` criando, ou o id de quem está sendo editado. */
  const [aberto, setAberto] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [salvando, setSalvando] = useState(false);

  function fechar() {
    setAberto(null);
    setTitle("");
    setContent("");
  }

  function abrirNovo() {
    setAberto("novo");
    setTitle("");
    setContent("");
  }

  function abrirEdicao(instruction: AiInstruction) {
    setAberto(instruction.id);
    setTitle(instruction.title);
    setContent(instruction.content);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim() || !aberto) return;
    setSalvando(true);
    try {
      if (aberto === "novo") {
        const created = await apiFetch<AiInstruction>("/ai/instructions", {
          method: "POST",
          body: JSON.stringify({ title, content }),
        });
        onChange([created, ...instructions]);
      } else {
        const updated = await apiFetch<AiInstruction>(`/ai/instructions/${aberto}`, {
          method: "PATCH",
          body: JSON.stringify({ title, content }),
        });
        onChange(instructions.map((item) => (item.id === updated.id ? updated : item)));
      }
      fechar();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Não deu pra salvar a regra.",
      );
    } finally {
      setSalvando(false);
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
      if (aberto === id) fechar();
    } catch {
      toast.error("Não deu pra remover a regra.");
    }
  }

  const editando = aberto !== null && aberto !== "novo";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">O que a IA precisa saber</h2>
          <p className="text-sm text-muted-foreground text-pretty">
            Escreva como explicaria pra um funcionário novo.
          </p>
        </div>
        {aberto === null ? (
          <Button size="sm" variant="outline" onClick={abrirNovo}>
            <Plus className="size-4" />
            Nova regra
          </Button>
        ) : null}
      </div>

      {/* Abre no lugar do botão (regra nova) ou no lugar da própria linha
          (edição), com o cursor já no primeiro campo: quem clicou quer
          digitar, não procurar onde digitar. */}
      {aberto === "novo" ? (
        <FormularioDeRegra
          title={title}
          content={content}
          salvando={salvando}
          rotuloDoBotao="Salvar regra"
          onTitleChange={setTitle}
          onContentChange={setContent}
          onSubmit={handleSubmit}
          onCancel={fechar}
        />
      ) : null}

      {instructions.length === 0 && aberto === null ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground text-pretty">
          Nenhuma regra ainda. A primeira costuma ser o horário de
          funcionamento ou o preço do que você vende.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {instructions.map((instruction) =>
            editando && aberto === instruction.id ? (
              <FormularioDeRegra
                key={instruction.id}
                title={title}
                content={content}
                salvando={salvando}
                rotuloDoBotao="Salvar alteração"
                onTitleChange={setTitle}
                onContentChange={setContent}
                onSubmit={handleSubmit}
                onCancel={fechar}
              />
            ) : (
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
                <button
                  type="button"
                  onClick={() => abrirEdicao(instruction)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="text-sm font-medium">{instruction.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground text-pretty">
                    {instruction.content}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={instruction.active}
                    onCheckedChange={() => handleToggle(instruction)}
                    aria-label={instruction.active ? "Desativar regra" : "Ativar regra"}
                    title={instruction.active ? "Desativar" : "Ativar"}
                  />
                  {/* Editar e remover aparecem no hover, e sempre em quem
                      navega por teclado: dois botões permanentes ao lado
                      de cada regra são ruído pra quem só está lendo a
                      lista. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => abrirEdicao(instruction)}
                    aria-label={`Editar ${instruction.title}`}
                    title="Editar"
                    className="size-8 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Pencil className="size-4" />
                  </Button>
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
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function FormularioDeRegra({
  title,
  content,
  salvando,
  rotuloDoBotao,
  onTitleChange,
  onContentChange,
  onSubmit,
  onCancel,
}: {
  title: string;
  content: string;
  salvando: boolean;
  rotuloDoBotao: string;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 duration-200 animate-in fade-in slide-in-from-top-1"
    >
      <Input
        autoFocus
        aria-label="Assunto da regra"
        placeholder="Assunto — ex.: Valor da consulta"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        maxLength={120}
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
        onChange={(e) => onContentChange(e.target.value)}
        maxLength={LIMITE_DO_CONTEUDO}
        className="resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <span
          className={cn(
            "text-xs tabular-nums",
            content.length > LIMITE_DO_CONTEUDO * 0.9
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {content.length.toLocaleString("pt-BR")} / {LIMITE_DO_CONTEUDO.toLocaleString("pt-BR")}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={salvando || !title.trim() || !content.trim()}>
            {salvando ? "Salvando..." : rotuloDoBotao}
          </Button>
        </div>
      </div>
    </form>
  );
}
