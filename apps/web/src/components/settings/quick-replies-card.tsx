"use client";

import { Pencil, Plus, Trash2, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-client";
import type { QuickReply } from "@/lib/types";

/**
 * Espelha a normalização da API pra a pessoa VER o atalho que vai valer.
 *
 * Não é a fonte da verdade — o servidor normaliza de novo, e é o dele que
 * vale. Existe só pra ninguém cadastrar "Bom Dia" e descobrir depois, no
 * meio de um atendimento, que o que abre é "/bom-dia".
 */
export function previewDoAtalho(bruto: string): string {
  return bruto
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

interface Rascunho {
  id: string | null;
  shortcut: string;
  title: string;
  content: string;
}

const VAZIO: Rascunho = { id: null, shortcut: "", title: "", content: "" };

export function QuickRepliesCard() {
  const [respostas, setRespostas] = useState<QuickReply[] | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    apiFetch<QuickReply[]>("/quick-replies")
      .then(setRespostas)
      .catch(() => toast.error("Não deu pra carregar as respostas rápidas."));
  }, []);

  const atalho = rascunho ? previewDoAtalho(rascunho.shortcut) : "";
  const podeSalvar = Boolean(atalho && rascunho?.content.trim());

  async function salvar() {
    if (!rascunho || !podeSalvar) return;
    setSalvando(true);
    try {
      const corpo = JSON.stringify({
        shortcut: rascunho.shortcut,
        title: rascunho.title,
        content: rascunho.content,
      });
      const salva = rascunho.id
        ? await apiFetch<QuickReply>(`/quick-replies/${rascunho.id}`, {
            method: "PATCH",
            body: corpo,
          })
        : await apiFetch<QuickReply>("/quick-replies", { method: "POST", body: corpo });

      setRespostas((atuais) =>
        rascunho.id
          ? (atuais ?? []).map((item) => (item.id === salva.id ? salva : item))
          : [...(atuais ?? []), salva],
      );
      setRascunho(null);
    } catch (erro) {
      // O conflito de atalho repetido vem com o nome do conflito na
      // mensagem; mostrar o texto da API é mais útil que "não deu certo".
      toast.error(erro instanceof Error ? erro.message : "Não deu pra salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id: string) {
    try {
      await apiFetch(`/quick-replies/${id}`, { method: "DELETE" });
      setRespostas((atuais) => (atuais ?? []).filter((item) => item.id !== id));
    } catch {
      toast.error("Não deu pra excluir.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="size-4" />
          Respostas rápidas
        </CardTitle>
        <CardDescription>
          Textos prontos que quem atende insere digitando <code className="rounded bg-muted px-1">/atalho</code>{" "}
          no início da mensagem. A lista aparece sozinha ao digitar a barra e se ordena pelas mais
          usadas — ninguém precisa organizar nada.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {respostas === null ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : respostas.length === 0 && !rascunho ? (
          <p className="text-xs text-muted-foreground text-pretty">
            Nenhuma ainda. As primeiras costumam ser a saudação, os dados de pagamento e o endereço.
          </p>
        ) : null}

        {(respostas ?? []).map((resposta) => (
          <div
            key={resposta.id}
            className="flex items-start justify-between gap-3 rounded-md border p-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  /{resposta.shortcut}
                </span>
                {resposta.title}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground text-pretty">
                {resposta.content}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Editar /${resposta.shortcut}`}
                onClick={() =>
                  setRascunho({
                    id: resposta.id,
                    shortcut: resposta.shortcut,
                    title: resposta.title ?? "",
                    content: resposta.content,
                  })
                }
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Excluir /${resposta.shortcut}`}
                onClick={() => void remover(resposta.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}

        {rascunho ? (
          <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="atalho" className="text-xs">
                  Atalho
                </Label>
                <Input
                  id="atalho"
                  value={rascunho.shortcut}
                  placeholder="bomdia"
                  onChange={(evento) =>
                    setRascunho({ ...rascunho, shortcut: evento.target.value })
                  }
                  className="w-40"
                />
                <span className="text-[11px] text-muted-foreground">
                  {atalho ? `Vai valer como /${atalho}` : "Só letras e números"}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="titulo" className="text-xs">
                  Nome na lista <span className="text-muted-foreground">(opcional)</span>
                </Label>
                <Input
                  id="titulo"
                  value={rascunho.title}
                  placeholder="Saudação de bom dia"
                  maxLength={80}
                  onChange={(evento) => setRascunho({ ...rascunho, title: evento.target.value })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="texto" className="text-xs">
                Texto enviado
              </Label>
              <Textarea
                id="texto"
                rows={3}
                value={rascunho.content}
                maxLength={4096}
                placeholder="Bom dia! Em que posso ajudar?"
                onChange={(evento) => setRascunho({ ...rascunho, content: evento.target.value })}
              />
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" disabled={!podeSalvar || salvando} onClick={() => void salvar()}>
                {salvando ? <Spinner /> : null}
                Salvar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRascunho(null)}>
                <X className="size-3.5" />
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => setRascunho(VAZIO)}
          >
            <Plus className="size-3.5" />
            Nova resposta rápida
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
