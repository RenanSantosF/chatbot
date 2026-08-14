"use client";

import { Download, ExternalLink, FileText, MapPin, Play } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { AudioMessage } from "./audio-message";
import { ImageLightbox } from "./image-lightbox";
import type { ConversationMessage } from "@/lib/types";

/**
 * O binário nunca vem direto da Meta: a URL dela expira em minutos e exige
 * o token do tenant, que não pode ir pro navegador. Por isso tudo aponta
 * pro nosso proxy autenticado.
 */
function mediaUrl(mediaId: string): string {
  return `/api/whatsapp/media/${mediaId}`;
}

function humanSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageAttachment({ message }: { message: ConversationMessage }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const meta = message.metadata;

  if (message.messageType === "LOCATION" && meta?.latitude !== undefined) {
    // Nome e endereço quando o cliente compartilha um lugar salvo; as
    // coordenadas quando ele solta o pino no mapa. O que sempre existe são
    // as coordenadas, então elas ficam na linha de baixo, discretas — a de
    // cima é pro humano ler, a de baixo é pra conferir.
    const titulo = meta.name || meta.address || "Localização compartilhada";
    const detalhe =
      meta.name && meta.address
        ? meta.address
        : `${Number(meta.latitude).toFixed(5)}, ${Number(meta.longitude).toFixed(5)}`;

    return (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${meta.latitude},${meta.longitude}`}
        target="_blank"
        rel="noopener noreferrer"
        className="group/mapa flex items-center gap-2.5 rounded-lg bg-black/5 p-2.5 transition-colors hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <MapPin className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{titulo}</span>
          <span className="block truncate text-[11px] tabular-nums opacity-70">{detalhe}</span>
        </span>
        <ExternalLink className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/mapa:opacity-60" />
      </a>
    );
  }

  if (!meta?.mediaId) return null;
  const url = mediaUrl(meta.mediaId);

  if (message.messageType === "IMAGE" && !failed) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir imagem"
          // A imagem vem pelo nosso proxy, que ainda busca na Meta — pode
          // demorar. Sem o esqueleto embaixo, o balão nascia com altura
          // zero e a conversa dava um salto quando a foto chegava.
          className="relative block min-h-24 w-full max-w-sm cursor-zoom-in overflow-hidden rounded-md"
        >
          {loaded ? null : (
            <span className="shimmer absolute inset-0 rounded-md bg-foreground/10" aria-hidden />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={message.content || "Imagem recebida"}
            onError={() => setFailed(true)}
            onLoad={() => setLoaded(true)}
            className={cn(
              "max-h-64 w-full max-w-full object-cover transition-all duration-300 hover:scale-[1.02]",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
        </button>
        {open ? (
          <ImageLightbox
            src={url}
            alt={message.content || "Imagem recebida"}
            fileName={meta.fileName}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </>
    );
  }

  if (message.messageType === "AUDIO") {
    return (
      <AudioMessage
        url={url}
        chave={meta.mediaId}
        voz={meta.voice}
        daEmpresa={message.senderType !== "CUSTOMER"}
      />
    );
  }

  if (message.messageType === "VIDEO" && !failed) {
    return (
      <video
        controls
        src={url}
        onError={() => setFailed(true)}
        className="max-h-64 w-auto max-w-full rounded-md"
      />
    );
  }

  const Icon = message.messageType === "VIDEO" ? Play : FileText;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={meta.fileName}
      className="flex items-center gap-2 rounded-md bg-black/5 px-2.5 py-2 dark:bg-white/10"
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{meta.fileName ?? "Arquivo"}</span>
        {meta.size ? <span className="block text-[10px] opacity-70">{humanSize(meta.size)}</span> : null}
      </span>
      <Download className="size-3.5 shrink-0 opacity-70" />
    </a>
  );
}
