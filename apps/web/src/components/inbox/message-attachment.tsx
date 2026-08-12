"use client";

import { Download, FileText, MapPin, Play } from "lucide-react";
import { useState } from "react";
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
  const meta = message.metadata;

  if (message.messageType === "LOCATION" && meta?.latitude !== undefined) {
    const label = [meta.name, meta.address].filter(Boolean).join(" — ");
    return (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${meta.latitude},${meta.longitude}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-md bg-black/5 px-2.5 py-2 text-xs underline-offset-4 hover:underline dark:bg-white/10"
      >
        <MapPin className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{label || "Ver localização no mapa"}</span>
      </a>
    );
  }

  if (!meta?.mediaId) return null;
  const url = mediaUrl(meta.mediaId);

  if (message.messageType === "IMAGE" && !failed) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={message.content || "Imagem recebida"}
          onError={() => setFailed(true)}
          className="max-h-64 w-auto max-w-full rounded-md object-cover"
        />
      </a>
    );
  }

  if (message.messageType === "AUDIO") {
    return <audio controls src={url} className="h-9 w-56 max-w-full" />;
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
