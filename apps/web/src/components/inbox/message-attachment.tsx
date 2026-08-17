"use client";

import {
  Download,
  ExternalLink,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  ImageOff,
  MapPin,
  Play,
} from "lucide-react";
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
  // Codificado porque o identificador deixou de ser sempre um número.
  // Numa conexão por QR code ele é a chave da mensagem —
  // "5527999@s.whatsapp.net|0|3EB0ABC" — e a barra vertical não é
  // permitida crua num caminho de URL. Em id da Meta (só dígitos) a
  // codificação não muda nada.
  return `/api/whatsapp/media/${encodeURIComponent(mediaId)}`;
}

/**
 * Toda figurinha do WhatsApp é WebP — está no protocolo, e o próprio
 * envio já se apoia nisso pra mandar como figurinha em vez de como foto
 * (ver `mediaKindFor` na API). Aqui é o mesmo acordo, do lado de cá.
 */
function ehFigurinha(mimeType?: string): boolean {
  return mimeType?.startsWith("image/webp") ?? false;
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
        className="group/mapa block w-64 max-w-full overflow-hidden rounded-lg bg-black/5 transition-colors hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
      >
        <MiniMapa latitude={Number(meta.latitude)} longitude={Number(meta.longitude)} />
        <span className="flex items-center gap-2 px-2.5 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{titulo}</span>
            <span className="block truncate text-[11px] tabular-nums opacity-70">{detalhe}</span>
          </span>
          <ExternalLink className="size-3.5 shrink-0 opacity-50 transition-opacity group-hover/mapa:opacity-90" />
        </span>
      </a>
    );
  }

  if (!meta?.mediaId) return null;
  const url = mediaUrl(meta.mediaId);

  /*
   * Figurinha é figurinha, não foto.
   *
   * Ela chega como IMAGE (é o que o WhatsApp entrega), e por isso era
   * desenhada como qualquer foto: cortada em `object-cover`, esticada até
   * 384px de largura, com fundo de balão atrás da transparência. Uma
   * carinha de 512px virava um cartaz opaco no meio da conversa.
   *
   * Aqui ela fica pequena, com o fundo aparecendo através dela, e sem
   * abrir o visualizador no clique — não há o que ampliar numa figurinha.
   */
  if (ehFigurinha(meta.mimeType) && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={message.content || "Figurinha"}
        onError={() => setFailed(true)}
        className="size-28 max-w-full object-contain"
      />
    );
  }

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
        conversationId={message.conversationId}
        messageId={message.id}
        transcricao={message.transcricao}
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

  /*
   * Foto ou vídeo que não carregou não vira "Arquivo".
   *
   * Este era o caminho de queda quando a imagem falhava, e ele mentia
   * duas vezes: dizia que o cliente tinha mandado um arquivo quando ele
   * mandou uma foto, e oferecia um download que também ia falhar. Quem
   * atendia clicava e recebia um JSON de erro na cara.
   *
   * A verdade é curta: era uma imagem, e ela não está mais disponível.
   */
  if (failed) {
    const oQueEra = message.messageType === "VIDEO" ? "vídeo" : "imagem";
    return (
      <span className="flex items-center gap-2 rounded-md bg-black/5 px-2.5 py-2 dark:bg-white/10">
        <ImageOff className="size-4 shrink-0 opacity-70" />
        <span className="min-w-0 text-xs opacity-80 text-pretty">
          Esta {oQueEra} não está mais disponível no WhatsApp.
        </span>
      </span>
    );
  }

  const arquivo = descreverArquivo(meta.fileName, meta.mimeType, message.messageType);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={meta.fileName}
      className="group/arq flex w-64 max-w-full items-center gap-2.5 rounded-lg bg-black/5 p-2 transition-colors hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
    >
      {/* O tipo do arquivo lido de longe.
          O cartão antigo dava o mesmo ícone cinza a um contrato, a uma
          planilha e a um vídeo, e obrigava a ler o nome inteiro — quase
          sempre cortado — pra saber o que era. Cor e extensão resolvem
          isso antes da leitura. */}
      <span
        className={cn(
          "flex size-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg",
          arquivo.cor,
        )}
      >
        <arquivo.Icone className="size-4" />
        {arquivo.extensao ? (
          <span className="text-[8px] font-bold tracking-tight uppercase">
            {arquivo.extensao}
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        {/* Duas linhas, e não uma cortada: nome de arquivo carrega a
            informação no fim ("...-assinado-v2.pdf"), justo o pedaço que
            o corte comia. */}
        <span className="line-clamp-2 text-[13px] leading-snug font-medium break-all">
          {arquivo.nome}
        </span>
        <span className="mt-0.5 block text-[11px] opacity-70">
          {[arquivo.rotulo, meta.size ? humanSize(meta.size) : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <Download className="size-4 shrink-0 opacity-40 transition-opacity group-hover/arq:opacity-90" />
    </a>
  );
}

/**
 * O que este arquivo é, pra quem só vai bater o olho.
 *
 * O tipo vem da extensão do nome, e não do mime: o WhatsApp manda
 * `application/octet-stream` com frequência, e a extensão que a pessoa vê
 * no próprio celular é a que ela vai procurar aqui.
 */
function descreverArquivo(
  fileName: string | undefined,
  mimeType: string | undefined,
  messageType: string,
): { nome: string; extensao: string; rotulo: string; cor: string; Icone: typeof FileText } {
  const nome = fileName?.trim() || "Arquivo";
  const extensao = (nome.includes(".") ? nome.split(".").pop() ?? "" : "")
    .toLowerCase()
    .slice(0, 4);

  if (messageType === "VIDEO" || mimeType?.startsWith("video/")) {
    return {
      nome,
      extensao,
      rotulo: "Vídeo",
      cor: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
      Icone: Play,
    };
  }

  const familias: {
    exts: string[];
    rotulo: string;
    cor: string;
    Icone: typeof FileText;
  }[] = [
    {
      exts: ["pdf"],
      rotulo: "PDF",
      cor: "bg-red-500/15 text-red-700 dark:text-red-300",
      Icone: FileText,
    },
    {
      exts: ["xls", "xlsx", "csv", "ods"],
      rotulo: "Planilha",
      cor: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      Icone: FileSpreadsheet,
    },
    {
      exts: ["doc", "docx", "odt", "rtf", "txt"],
      rotulo: "Documento",
      cor: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
      Icone: FileText,
    },
    {
      exts: ["zip", "rar", "7z", "tar", "gz"],
      rotulo: "Compactado",
      cor: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      Icone: FileArchive,
    },
    {
      exts: ["png", "jpg", "jpeg", "webp", "gif", "heic"],
      rotulo: "Imagem",
      cor: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
      Icone: FileImage,
    },
    {
      exts: ["mp3", "wav", "ogg", "m4a", "aac"],
      rotulo: "Áudio",
      cor: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
      Icone: FileAudio,
    },
  ];

  const familia = familias.find((f) => f.exts.includes(extensao));
  return familia
    ? { nome, extensao, rotulo: familia.rotulo, cor: familia.cor, Icone: familia.Icone }
    : {
        nome,
        extensao,
        rotulo: "Arquivo",
        cor: "bg-foreground/10 text-foreground/70",
        Icone: FileText,
      };
}

/**
 * Um mapa desenhado aqui mesmo, sem sair para lugar nenhum.
 *
 * O cartão de localização era um pino num quadradinho: dizia que ALGUÉM
 * mandou um lugar, e nada sobre o lugar. A prévia de verdade — imagem de
 * mapa estático — exigiria chave de API de terceiro e uma requisição
 * externa por balão, com o endereço do cliente viajando junto.
 *
 * Isto é o meio-termo honesto: não finge ser o mapa real (as ruas são
 * decorativas e derivadas das coordenadas, então o mesmo lugar desenha
 * sempre igual), mas dá ao cartão o peso visual de um lugar e deixa claro
 * que se clica pra abrir. O mapa de verdade está a um toque.
 */
function MiniMapa({ latitude, longitude }: { latitude: number; longitude: number }) {
  // Semente estável e derivação pura: o mesmo ponto desenha sempre o
  // mesmo traçado, senão o balão "muda de lugar" a cada render.
  const semente =
    Math.abs(Math.round((latitude * 3163 + longitude * 7919) * 1000)) || 1;
  const sorteio = (n: number) =>
    (((semente * (n + 7) * 1103515245 + 12345) >>> 0) % 1000) / 1000;

  const vias = Array.from({ length: 5 }, (_, i) => ({
    p: 12 + sorteio(i * 3) * 76,
    horizontal: sorteio(i * 3 + 1) > 0.5,
    grossa: sorteio(i * 3 + 2) > 0.65,
  }));

  return (
    <span className="relative block h-24 w-full overflow-hidden bg-primary/10">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
        className="absolute inset-0 size-full text-primary"
      >
        {vias.map((via, i) => (
          <line
            key={i}
            x1={via.horizontal ? 0 : via.p}
            y1={via.horizontal ? via.p : 0}
            x2={via.horizontal ? 100 : via.p}
            y2={via.horizontal ? via.p : 100}
            stroke="currentColor"
            strokeWidth={via.grossa ? 2.5 : 1.2}
            opacity={via.grossa ? 0.28 : 0.16}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <span className="absolute top-1/2 left-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-4 ring-primary/25">
        <MapPin className="size-3.5" />
      </span>
    </span>
  );
}
