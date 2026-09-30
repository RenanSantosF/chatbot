"use client";

import { FileText, Plus, SendHorizonal, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
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
  files,
  sending,
  caption,
  onCaptionChange,
  onRemove,
  onAdd,
  onCancel,
  onSend,
}: {
  /** Um ou vários — vão na ordem, um de cada vez. */
  files: File[];
  sending: boolean;
  /**
   * A legenda É o rascunho da conversa, e não um campo à parte.
   *
   * Quem já tinha escrito a mensagem e só depois colou a imagem perdia o
   * texto pra legenda: a imagem saía sozinha e a frase ficava no campo,
   * esperando um segundo envio. Compartilhando o mesmo texto, o que já
   * estava escrito vira a legenda, e descartar o anexo devolve o texto
   * (com o que foi editado) pro campo de mensagem. Com vários anexos, ela
   * vai no primeiro.
   */
  caption: string;
  onCaptionChange: (caption: string) => void;
  /** Tira um arquivo da lista; tirar o último é o mesmo que cancelar. */
  onRemove: (indice: number) => void;
  /** Abre o seletor de arquivos pra somar mais à lista. */
  onAdd: () => void;
  onCancel: () => void;
  onSend: (caption: string) => void;
}) {
  const varios = files.length > 1;

  return (
    <div
      data-anexo-aberto
      className="flex flex-col gap-3 bg-card px-3 pt-4 pb-3 duration-200 animate-in fade-in slide-in-from-bottom-2"
    >
      {/* Um só: a prévia grande de sempre. Vários: uma fileira que rola de
          lado, cada um com o próprio X, e o "+" no fim pra somar mais. */}
      <div
        className={cn(
          "flex min-w-0 items-center gap-3 px-1 pt-2",
          varios && "overflow-x-auto pb-1 [scrollbar-width:thin]",
        )}
      >
        {files.map((file, indice) => (
          <PreviaDoAnexo
            key={`${file.name}-${file.size}-${file.lastModified}-${indice}`}
            file={file}
            compacta={varios}
            disabled={sending}
            onRemove={() => (files.length === 1 ? onCancel() : onRemove(indice))}
          />
        ))}
        <button
          type="button"
          onClick={onAdd}
          disabled={sending}
          aria-label="Adicionar mais arquivos"
          title="Adicionar mais arquivos"
          className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-5" />
        </button>
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
          placeholder={
            varios
              ? `Legenda (vai junto do primeiro) · ${files.length} arquivos`
              : "Escreva uma legenda (opcional)"
          }
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

/** A prévia de um anexo: a foto, ou o cartão com nome e tamanho. */
function PreviaDoAnexo({
  file,
  compacta,
  disabled,
  onRemove,
}: {
  file: File;
  compacta: boolean;
  disabled: boolean;
  onRemove: () => void;
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
    // blob na memória da aba até recarregar a página. Com um respiro: em
    // desenvolvimento o React desmonta e remonta o efeito de propósito.
    return () => {
      if (preview) setTimeout(() => URL.revokeObjectURL(preview), 10_000);
    };
  }, [preview]);

  const descartar = (
    <button
      type="button"
      onClick={onRemove}
      disabled={disabled}
      aria-label={`Tirar ${file.name}`}
      title="Tirar"
      className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-foreground/80 text-background shadow-sm transition-colors hover:bg-foreground"
    >
      <X className="size-3.5" />
    </button>
  );

  if (preview) {
    return (
      <div className="relative min-w-0 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preview}
          alt="Prévia do anexo"
          className={cn(
            "block rounded-lg object-cover ring-1 ring-border",
            compacta ? "size-14" : "max-h-44 max-w-full object-contain",
          )}
        />
        {descartar}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg bg-muted px-3 py-2.5 pr-5 dark:bg-input/40",
        compacta && "h-14 max-w-52",
      )}
    >
      <FileText className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {Math.max(1, Math.round(file.size / 1024))} KB
        </p>
      </div>
      {descartar}
    </div>
  );
}
