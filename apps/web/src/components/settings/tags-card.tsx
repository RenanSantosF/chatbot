"use client";

import { Check, Tags, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CORES, TagChip, tomDa } from "@/components/inbox/tag-picker";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Tag } from "@/lib/types";

/**
 * Onde as etiquetas são arrumadas — não onde nascem.
 *
 * Criar acontece dentro da conversa, com quem está atendendo (ver
 * TagPicker). Aqui é o depois: dar cor, corrigir o nome que saiu torto e
 * apagar o que não pegou. É por isso que a tela não tem formulário de
 * criação: ela existe pra arrumar, e arrumar é tarefa de quem configura.
 */
export function TagsCard() {
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [nome, setNome] = useState("");

  useEffect(() => {
    apiFetch<Tag[]>("/tags")
      .then(setTags)
      .catch(() => toast.error("Não deu pra carregar as etiquetas."));
  }, []);

  async function salvar(id: string, dados: Partial<Pick<Tag, "name" | "color">>) {
    try {
      const atualizada = await apiFetch<Tag>(`/tags/${id}`, {
        method: "PATCH",
        body: JSON.stringify(dados),
      });
      setTags((atuais) =>
        (atuais ?? []).map((tag) =>
          tag.id === id ? { ...tag, ...atualizada } : tag,
        ),
      );
      setEditando(null);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não deu pra salvar.");
    }
  }

  async function excluir(tag: Tag) {
    try {
      await apiFetch(`/tags/${tag.id}`, { method: "DELETE" });
      setTags((atuais) => (atuais ?? []).filter((item) => item.id !== tag.id));
    } catch {
      toast.error("Não deu pra excluir.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tags className="size-4" />
          Etiquetas
        </CardTitle>
        <CardDescription>
          Classificam a conversa por assunto — &ldquo;Orçamento&rdquo;, &ldquo;Reclamação&rdquo;,
          &ldquo;Segunda via&rdquo;. Quem atende cria e aplica direto na conversa; aqui você ajusta
          cor e nome, e tira as que não pegaram.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {tags === null ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : tags.length === 0 ? (
          <p className="text-xs text-muted-foreground text-pretty">
            Nenhuma ainda. Elas nascem no botão de etiqueta dentro da conversa, com quem está
            atendendo.
          </p>
        ) : null}

        {(tags ?? []).map((tag) => (
          <div
            key={tag.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {editando === tag.id ? (
                <Input
                  autoFocus
                  value={nome}
                  onChange={(evento) => setNome(evento.target.value)}
                  onBlur={() => void salvar(tag.id, { name: nome })}
                  onKeyDown={(evento) => {
                    if (evento.key === "Enter") void salvar(tag.id, { name: nome });
                    if (evento.key === "Escape") setEditando(null);
                  }}
                  className="h-8 w-48"
                />
              ) : (
                <button
                  type="button"
                  title="Clique para renomear"
                  onClick={() => {
                    setEditando(tag.id);
                    setNome(tag.name);
                  }}
                >
                  <TagChip tag={tag} className="px-2 py-1 text-xs" />
                </button>
              )}
              <span className="text-xs text-muted-foreground">
                {tag.conversationCount === 1
                  ? "1 conversa"
                  : `${tag.conversationCount ?? 0} conversas`}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* A paleta é fechada: cor livre produz etiqueta ilegível em
                  um dos dois temas, e quem escolheu não usa os dois pra
                  descobrir. */}
              <div className="flex items-center gap-1">
                {CORES.map((cor) => (
                  <button
                    key={cor}
                    type="button"
                    aria-label={`Cor ${cor}`}
                    title={cor}
                    onClick={() => void salvar(tag.id, { color: cor })}
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full",
                      tomDa(cor),
                    )}
                  >
                    {tag.color === cor ? <Check className="size-3" /> : null}
                  </button>
                ))}
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Excluir etiqueta ${tag.name}`}
                onClick={() => void excluir(tag)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
