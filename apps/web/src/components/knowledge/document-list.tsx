"use client";

import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { KnowledgeDocument, KnowledgeDocumentStatus } from "@/lib/types";

const STATUS_LABEL: Record<KnowledgeDocumentStatus, string> = {
  PROCESSING: "Processando",
  READY: "Pronto",
  FAILED: "Falhou",
};

const STATUS_VARIANT: Record<KnowledgeDocumentStatus, "default" | "secondary" | "destructive"> = {
  PROCESSING: "secondary",
  READY: "default",
  FAILED: "destructive",
};

export function DocumentList({
  documents,
  onChange,
}: {
  documents: KnowledgeDocument[];
  onChange: (documents: KnowledgeDocument[]) => void;
}) {
  async function handleDelete(id: string) {
    try {
      await apiFetch(`/knowledge/documents/${id}`, { method: "DELETE" });
      onChange(documents.filter((document) => document.id !== id));
    } catch {
      toast.error("Não deu pra remover o documento.");
    }
  }

  /*
   * Sem cartão e sem cabeçalho próprio.
   *
   * O Card trazia um título "Documentos" e um subtítulo, e a seção que o
   * abriga na tela de Conhecimento já diz as duas coisas — o resultado era
   * a palavra "Documentos" escrita duas vezes, uma embaixo da outra. Aqui
   * ficou só a lista, no mesmo formato das regras logo acima: cada item é
   * um cartão discreto, e o remover só aparece quando o mouse chega.
   */
  if (documents.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        Nenhum documento ainda.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {documents.map((document) => (
        <li
          key={document.id}
          className="group flex items-start gap-3 rounded-xl border bg-card px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{document.title}</p>
            <p className="text-xs text-muted-foreground">{document.fileName}</p>
            {document.status === "FAILED" && document.errorMessage ? (
              <p className="mt-1 text-xs text-destructive">{document.errorMessage}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant={STATUS_VARIANT[document.status]}>
              {STATUS_LABEL[document.status]}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remover ${document.title}`}
              title="Remover"
              className="size-8 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive"
              onClick={() => handleDelete(document.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
