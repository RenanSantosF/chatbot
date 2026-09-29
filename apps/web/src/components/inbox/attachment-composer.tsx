"use client";

import { FileText, SendHorizonal, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Spinner } from "@/components/ui/spinner";
import { CAMPO_DE_MENSAGEM } from "./campo-de-mensagem";

/**
 * Passo intermediário entre escolher o arquivo e mandar. Existe porque
 * enviar direto tira da pessoa a única chance de escrever a legenda — e
 * legenda depois vira uma segunda mensagem solta, que não é a mesma coisa.
 *
 * O visual segue o do compositor: a prévia num cartão com o X no próprio
 * canto (e não solto na outra ponta da tela, onde ele sumia atrás de
 * outras coisas), e a legenda no mesmo campo preenchido da mensagem.
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

  const descartar = (
    <button
      type="button"
      onClick={onCancel}
      disabled={sending}
      aria-label="Descartar anexo"
      title="Descartar"
      className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-foreground/80 text-background shadow-sm transition-colors hover:bg-foreground"
    >
      <X className="size-3.5" />
    </button>
  );

  return (
    <div
      data-anexo-aberto
      className="flex flex-col gap-3 bg-card px-3 pt-4 pb-3 duration-200 animate-in fade-in slide-in-from-bottom-2"
    >
      {/* `min-w-0` e `max-w-full` são o que segura o X na tela: um print
          largo tinha a largura natural dele como mínimo e empurrava tudo
          pra fora do painel. */}
      <div className="flex min-w-0 px-1">
        {preview ? (
          <div className="relative min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Prévia do anexo"
              className="block max-h-44 max-w-full rounded-lg object-contain ring-1 ring-border"
            />
            {descartar}
          </div>
        ) : (
          <div className="relative flex min-w-0 items-center gap-2.5 rounded-lg bg-muted px-3 py-2.5 pr-5 dark:bg-input/40">
            <FileText className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {Math.max(1, Math.round(file.size / 1024))} KB
              </p>
            </div>
            {descartar}
          </div>
        )}
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSend(caption.trim());
        }}
      >
        <textarea
          autoFocus
          rows={1}
          value={caption}
          onChange={(event) => onCaptionChange(event.target.value)}
          // O cursor no fim do que já estava escrito, pra continuar a frase.
          onFocus={(event) => {
            const fim = event.currentTarget.value.length;
            event.currentTarget.setSelectionRange(fim, fim);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Escreva uma legenda (opcional)"
          aria-label="Legenda"
          disabled={sending}
          className={CAMPO_DE_MENSAGEM}
        />
        <button
          type="submit"
          aria-label="Enviar anexo"
          disabled={sending}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[filter] hover:brightness-110 disabled:opacity-60"
        >
          {sending ? <Spinner /> : <SendHorizonal className="size-4.5" />}
        </button>
      </form>
    </div>
  );
}
