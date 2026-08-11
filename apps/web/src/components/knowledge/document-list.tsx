"use client";

import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documentos</CardTitle>
        <CardDescription>O que sua IA pode consultar hoje.</CardDescription>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Nenhum documento ainda.</p>
        ) : (
          <div className="flex flex-col divide-y">
            {documents.map((document) => (
              <div key={document.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{document.title}</p>
                  <p className="text-xs text-muted-foreground">{document.fileName}</p>
                  {document.status === "FAILED" && document.errorMessage ? (
                    <p className="mt-1 text-xs text-destructive">{document.errorMessage}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={STATUS_VARIANT[document.status]}>{STATUS_LABEL[document.status]}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => handleDelete(document.id)}
                  >
                    Remover
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
