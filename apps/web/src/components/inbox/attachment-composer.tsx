"use client";

import { FileText, SendHorizonal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

/**
 * Passo intermediário entre escolher o arquivo e mandar. Existe porque
 * enviar direto tira da pessoa a única chance de escrever a legenda — e
 * legenda depois vira uma segunda mensagem solta, que não é a mesma coisa.
 */
export function AttachmentComposer({
  file,
  sending,
  onCancel,
  onSend,
}: {
  file: File;
  sending: boolean;
  onCancel: () => void;
  onSend: (caption: string) => void;
}) {
  const [caption, setCaption] = useState("");
  // A URL do blob é derivada do arquivo, não estado assíncrono — criar no
  // render e revogar na limpeza evita o setState dentro de efeito (e o
  // quadro extra em que a prévia ainda não existe).
  const preview = useMemo(
    () => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    [file],
  );

  useEffect(() => {
    // Revogar é obrigatório: sem isso cada arquivo escolhido segura o
    // blob na memória da aba até recarregar a página.
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  return (
    <div className="flex flex-col gap-3 bg-card p-4 duration-200 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-start gap-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Prévia do anexo"
            className="max-h-40 rounded-md object-contain"
          />
        ) : (
          <div className="flex items-center gap-2.5 rounded-md bg-muted px-3 py-2.5">
            <FileText className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {Math.max(1, Math.round(file.size / 1024))} KB
              </p>
            </div>
          </div>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto shrink-0"
          aria-label="Descartar anexo"
          onClick={onCancel}
          disabled={sending}
        >
          <X className="size-4" />
        </Button>
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSend(caption.trim());
        }}
      >
        <Input
          autoFocus
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          placeholder="Escreva uma legenda (opcional)"
          disabled={sending}
        />
        <Button type="submit" size="icon-lg" aria-label="Enviar anexo" disabled={sending}>
          {sending ? <Spinner /> : <SendHorizonal className="size-4" />}
        </Button>
      </form>
    </div>
  );
}
