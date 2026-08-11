"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { KnowledgeDocument } from "@/lib/types";

const ACCEPTED_EXTENSIONS = ".pdf,.docx,.txt,.csv,.xlsx,.xls";

export function UploadCard({ onUploaded }: { onUploaded: (document: KnowledgeDocument) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error("Escolha um arquivo primeiro.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    if (title.trim()) {
      formData.append("title", title.trim());
    }

    setUploading(true);
    try {
      const document = await apiFetch<KnowledgeDocument>("/knowledge/documents", {
        method: "POST",
        body: formData,
      });
      onUploaded(document);
      setTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success(
        document.status === "READY" ? "Documento processado." : "Upload feito, veja o status na lista.",
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não deu pra enviar o documento.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enviar documento</CardTitle>
        <CardDescription>
          PDF, DOCX, TXT, CSV ou XLSX, até 10MB. O texto é dividido em trechos e indexado pra IA consultar
          só o que for relevante em cada pergunta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="doc-title" className="text-xs">
              Título (opcional)
            </Label>
            <Input
              id="doc-title"
              className="w-56"
              placeholder="Ex: Tabela de preços"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="doc-file" className="text-xs">
              Arquivo
            </Label>
            <Input id="doc-file" type="file" accept={ACCEPTED_EXTENSIONS} ref={fileInputRef} className="w-64" />
          </div>
          <Button type="submit" disabled={uploading}>
            {uploading ? "Processando..." : "Enviar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
