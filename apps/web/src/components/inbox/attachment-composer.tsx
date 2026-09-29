"use client";

import { FileText, SendHorizonal, X } from "lucide-react";
import { useEffect, useMemo } from "react";
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
  caption,
  onCaptionChange,
  onCancel,
  onSend,
}: {
  file: File;
  sending: boolean;
  /**
   * A legenda É o rascunho da conversa, e não um campo à parte.
   *
   * Quem já tinha escrito a mensagem e só depois colou a imagem perdia o
   * texto pra legenda: a imagem saía sozinha e a frase ficava no campo,
   * esperando um segundo envio. Compartilhando o mesmo texto, o que já
   * estava escrito vira a legenda, e descartar o anexo devolve o texto
   * (com o que foi editado) pro campo de mensagem.
   */
  caption: string;
  onCaptionChange: (caption: string) => void;
  onCancel: () => void;
  onSend: (caption: string) => void;
}) {
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
    //
    // Com um respiro, e não na hora: em desenvolvimento o React desmonta e
    // remonta o efeito de propósito, e revogar na hora quebrava a prévia
    // antes de a imagem carregar. Imagem já desenhada não precisa mais do
    // endereço.
    return () => {
      if (preview) setTimeout(() => URL.revokeObjectURL(preview), 10_000);
    };
  }, [preview]);

  return (
    <div
      data-anexo-aberto
      className="flex flex-col gap-3 bg-card p-4 duration-200 animate-in fade-in slide-in-from-bottom-2"
    >
      {/* `min-w-0` na prévia é o que segura o X na tela: um print largo
          tinha a largura natural dele como mínimo, empurrava o botão pra
          fora do painel e não havia como descartar o anexo. */}
      <div className="flex items-start gap-3">
        {preview ? (
          <div className="min-w-0 flex-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Prévia do anexo"
              className="max-h-40 max-w-full rounded-md object-contain"
            />
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2.5 rounded-md bg-muted px-3 py-2.5">
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
          onChange={(event) => onCaptionChange(event.target.value)}
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
