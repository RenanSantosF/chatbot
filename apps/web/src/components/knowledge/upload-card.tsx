"use client";

import { Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import type { KnowledgeDocument } from "@/lib/types";

const ACCEPTED_EXTENSIONS = ".pdf,.docx,.txt,.csv,.xlsx,.xls";

export function UploadCard({ onUploaded }: { onUploaded: (document: KnowledgeDocument) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [arquivo, setArquivo] = useState("");
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
      setArquivo("");
      toast.success(
        document.status === "READY" ? "Documento processado." : "Upload feito, veja o status na lista.",
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não deu pra enviar o documento.");
    } finally {
      setUploading(false);
    }
  }

  /*
   * Sem cartão e sem rótulo em cima de cada campo.
   *
   * O envio ficava dentro de um Card com título e um parágrafo explicando
   * a indexação — três níveis de moldura em volta de dois campos e um
   * botão. A seção que abriga isto já se apresenta, e o que sobrava aqui
   * era decoração: o `placeholder` diz o que vai no campo, e a linha de
   * formatos aceitos vale mais embaixo, discreta, do que como manchete.
   */
  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Título do documento (opcional)"
          className="h-9 min-w-48 flex-1"
          placeholder="Título — opcional, ex.: Tabela de preços"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {/* O <input type="file"> fica escondido, e quem aparece é um botão
            nosso. O controle nativo desenha "Choose File / No file chosen"
            com a fonte e a borda do sistema operacional, em inglês, no meio
            de uma tela em português — e não há CSS que o conserte. Um
            <label> apontando pro campo escondido tem o mesmo comportamento
            (inclusive por teclado) e a nossa aparência. */}
        <input
          ref={fileInputRef}
          id="doc-file"
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          className="sr-only"
          onChange={(e) => setArquivo(e.target.files?.[0]?.name ?? "")}
        />
        <label
          htmlFor="doc-file"
          className="flex h-9 max-w-64 min-w-40 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors hover:border-ring/60"
        >
          <Paperclip className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", !arquivo && "text-muted-foreground")}>
            {arquivo || "Escolher arquivo"}
          </span>
        </label>

        <Button type="submit" size="sm" disabled={uploading}>
          {uploading ? "Processando..." : "Enviar"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground text-pretty">
        PDF, DOCX, TXT, CSV ou XLSX, até 10 MB. O texto é dividido em trechos e
        indexado — a IA consulta só o que for relevante em cada pergunta.
      </p>
    </form>
  );
}
