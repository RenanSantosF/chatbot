"use client";

import { Mic, Pause, Play, Send, Trash2 } from "lucide-react";
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

function extensionFor(mimeType: string) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("mpeg")) return "mp3";
  return "webm";
}

/** Barras que sobem e descem enquanto grava — o mesmo sinal de vida do app. */
function Waveform({ paused }: { paused: boolean }) {
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {[0, 1, 2, 3, 4].map((index) => (
        <span
          key={index}
          className={cn(
            "w-0.5 rounded-full bg-primary",
            paused ? "h-1.5 opacity-50" : "animate-[onda_0.9s_ease-in-out_infinite]",
          )}
          style={paused ? undefined : { height: "0.75rem", animationDelay: `${index * 110}ms` }}
        />
      ))}
    </span>
  );
}

export function VoiceRecorder({
  disabled,
  onRecorded,
}: {
  disabled?: boolean;
  onRecorded: (file: File) => Promise<void>;
}) {
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Descartar precisa ser lido dentro do onstop, que roda depois e enxerga
  // o estado congelado do render em que foi criado.
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!recording || paused) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording, paused]);

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
      void onRecorded(
        new File([blob], `audio-${Date.now()}.${extensionFor(mimeType)}`, { type: mimeType }),
      );
    };

    recorder.start();
    recorderRef.current = recorder;
    setSeconds(0);
    setPaused(false);
    setRecording(true);
  }

  function togglePause() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      setPaused(true);
    } else if (recorder.state === "paused") {
      recorder.resume();
      setPaused(false);
    }
  }

  function finish(cancel: boolean) {
    cancelledRef.current = cancel;
    // Um recorder pausado não dispara ondataavailable ao parar; retomar
    // antes garante que o último pedaço entre no arquivo.
    if (recorderRef.current?.state === "paused") recorderRef.current.resume();
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    setPaused(false);
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
    <div className="flex flex-1 items-center gap-2 rounded-full bg-muted px-2 py-1 duration-200 animate-in fade-in slide-in-from-bottom-1">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Descartar gravação"
        title="Descartar"
        className="text-destructive hover:text-destructive"
        onClick={() => finish(true)}
      >
        <Trash2 className="size-4" />
      </Button>

      <Waveform paused={paused} />

      <span className="text-xs tabular-nums" aria-live="polite">
        {clock(seconds)}
      </span>

      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={paused ? "Retomar gravação" : "Pausar gravação"}
        title={paused ? "Retomar" : "Pausar"}
        onClick={togglePause}
      >
        {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
      </Button>

      {/* Sem "ouvir uma vez": a Cloud API não expõe view_once no envio —
          é recurso só do aplicativo. Um controle que não faz nada é pior
          que a ausência dele. */}
      <Button
        type="button"
        size="icon-sm"
        className="ml-auto"
        aria-label="Enviar áudio"
        title="Enviar áudio"
        onClick={() => finish(false)}
      >
        <Send className="size-4" />
      </Button>
    </div>
  );
}
