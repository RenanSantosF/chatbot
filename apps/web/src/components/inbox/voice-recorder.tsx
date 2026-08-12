"use client";

import { Mic, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A Meta só aceita áudio em aac, amr, mpeg, mp4 ou ogg/opus — webm, que é
 * o padrão do Chrome, ela recusa. Pedimos o melhor container aceito que o
 * navegador souber gravar e deixamos o webm por último: nesse caso a API
 * converte antes de mandar (e avisa se não conseguir).
 */
const PREFERRED_MIME_TYPES = [
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
  "audio/webm;codecs=opus",
  "audio/webm",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

function clock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VoiceRecorder({
  disabled,
  onRecorded,
}: {
  disabled?: boolean;
  onRecorded: (file: File) => Promise<void>;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Cancelar precisa ser lido lá dentro do onstop, que é assíncrono e
  // enxerga o estado congelado do render em que foi criado.
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    // Solta o microfone se a pessoa sair da tela no meio da gravação —
    // senão o indicador do navegador fica aceso pra sempre.
    return () => {
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function start() {
    const mimeType = pickMimeType();
    if (!mimeType) {
      toast.error("Este navegador não grava áudio.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Libere o microfone no navegador pra gravar.");
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    cancelledRef.current = false;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (cancelledRef.current) return;
      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (blob.size === 0) return;
      const extension = mimeType.includes("ogg")
        ? "ogg"
        : mimeType.includes("mp4")
          ? "m4a"
          : mimeType.includes("mpeg")
            ? "mp3"
            : "webm";
      void onRecorded(
        new File([blob], `audio-${Date.now()}.${extension}`, { type: mimeType }),
      );
    };

    recorder.start();
    recorderRef.current = recorder;
    setSeconds(0);
    setRecording(true);
  }

  function finish(cancel: boolean) {
    cancelledRef.current = cancel;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  if (!recording) {
    return (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Gravar áudio"
        title="Gravar áudio"
        disabled={disabled}
        onClick={() => void start()}
      >
        <Mic className="size-4" />
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1">
      <span
        className={cn("size-2 shrink-0 rounded-full bg-destructive", "animate-pulse")}
        aria-hidden
      />
      <span className="text-xs tabular-nums" aria-live="polite">
        Gravando {clock(seconds)}
      </span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Descartar gravação"
        title="Descartar"
        onClick={() => finish(true)}
      >
        <Trash2 className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        aria-label="Enviar áudio"
        title="Enviar áudio"
        onClick={() => finish(false)}
      >
        <Send className="size-4" />
      </Button>
    </div>
  );
}
