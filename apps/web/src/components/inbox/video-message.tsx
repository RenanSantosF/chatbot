"use client";

import {
  Download,
  Maximize,
  Minimize,
  Pause,
  Play,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

function relogio(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return "0:00";
  const total = Math.floor(segundos);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * O vídeo dentro do balão, com controles nossos.
 *
 * Era o `<video controls>` do navegador: a barra cinza de cada sistema,
 * grudada num quadro preto, e um botão de tela cheia que tomava o monitor
 * inteiro — tudo o que a conversa não é. Aqui é o jeito do WhatsApp: o
 * primeiro quadro como capa, um botão de tocar no meio, a duração no
 * canto, e o vídeo toca ali mesmo, sem sair da conversa. Tela cheia existe,
 * mas só quando a pessoa pede, pelo botão da barra (ou duplo clique).
 *
 * A caixa tem proporção fixa desde o primeiro quadro (quadrada até o
 * vídeo dizer o tamanho dele, e limitada a uma faixa depois). Sem isso o
 * balão nascia pequeno e crescia quando o vídeo carregava, e a conversa
 * perdia o fim de vista.
 */
export function VideoMessage({
  url,
  fileName,
  onFalha,
}: {
  url: string;
  fileName?: string;
  onFalha: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const [telaCheia, setTelaCheia] = useState(false);

  useEffect(() => {
    const aoMudar = () => setTelaCheia(document.fullscreenElement === caixaRef.current);
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, []);

  function alternarTelaCheia() {
    // A CAIXA vai pra tela cheia, e não o <video>: assim a barra e os
    // botões continuam sendo os nossos lá também.
    if (document.fullscreenElement) void document.exitFullscreen();
    else void caixaRef.current?.requestFullscreen().catch(() => {});
  }
  const [proporcao, setProporcao] = useState(1);
  const [tocando, setTocando] = useState(false);
  const [jaTocou, setJaTocou] = useState(false);
  const [esperando, setEsperando] = useState(false);
  const [duracao, setDuracao] = useState(0);
  const [agora, setAgora] = useState(0);
  const [mudo, setMudo] = useState(false);

  function alternar() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => setEsperando(false));
    } else {
      video.pause();
    }
  }

  function buscar(evento: React.PointerEvent<HTMLDivElement>) {
    const video = videoRef.current;
    if (!video || !duracao) return;
    const faixa = evento.currentTarget.getBoundingClientRect();
    const fracao = Math.min(Math.max((evento.clientX - faixa.left) / faixa.width, 0), 1);
    video.currentTime = fracao * duracao;
    setAgora(video.currentTime);
  }

  return (
    <div
      ref={caixaRef}
      style={telaCheia ? undefined : { aspectRatio: `1 / ${proporcao}` }}
      className={cn(
        "group/video relative w-72 max-w-full overflow-hidden rounded-xl bg-black",
        telaCheia && "size-full max-w-none rounded-none",
      )}
    >
      <video
        ref={videoRef}
        // `#t=0.1` faz o navegador desenhar um quadro de verdade como capa,
        // em vez da caixa preta — sem baixar o vídeo inteiro pra isso.
        src={`${url}#t=0.1`}
        preload="metadata"
        playsInline
        disablePictureInPicture
        controlsList="nofullscreen nodownload noremoteplayback"
        onLoadedMetadata={(evento) => {
          const { videoWidth, videoHeight, duration } = evento.currentTarget;
          if (videoWidth && videoHeight) {
            setProporcao(Math.min(Math.max(videoHeight / videoWidth, 0.6), 1.4));
          }
          setDuracao(duration);
        }}
        onTimeUpdate={(evento) => setAgora(evento.currentTarget.currentTime)}
        onPlay={() => {
          setTocando(true);
          setJaTocou(true);
        }}
        onPause={() => setTocando(false)}
        onEnded={() => setTocando(false)}
        onWaiting={() => setEsperando(true)}
        onPlaying={() => setEsperando(false)}
        onCanPlay={() => setEsperando(false)}
        onVolumeChange={(evento) => setMudo(evento.currentTarget.muted)}
        onError={onFalha}
        onClick={alternar}
        onDoubleClick={alternarTelaCheia}
        className={cn(
          "absolute inset-0 size-full cursor-pointer",
          // Parado, a capa preenche a caixa como uma foto; tocando, o
          // vídeo aparece inteiro, sem corte.
          jaTocou || telaCheia ? "object-contain" : "object-cover",
        )}
      />

      {/* O botão do meio: tocar, ou o giro enquanto carrega. */}
      {!tocando || esperando ? (
        <button
          type="button"
          onClick={alternar}
          aria-label={tocando ? "Carregando" : "Tocar vídeo"}
          className="absolute inset-0 m-auto flex size-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-transform hover:scale-105"
        >
          {esperando ? (
            <span className="size-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <Play className="ml-0.5 size-6 fill-current" />
          )}
        </button>
      ) : null}

      {/* Antes de tocar: só a duração, no canto, como no WhatsApp. */}
      {!jaTocou && duracao ? (
        <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums">
          <Video className="size-3" />
          {relogio(duracao)}
        </span>
      ) : null}

      {/* Depois de tocar: a barra, que some quando o mouse sai e o vídeo
          está rodando — o vídeo é o que importa. */}
      {jaTocou ? (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-linear-to-t from-black/70 to-transparent px-2.5 pt-6 pb-2 text-white transition-opacity",
            tocando && !esperando ? "opacity-0 group-hover/video:opacity-100" : "opacity-100",
          )}
        >
          <div
            role="slider"
            aria-label="Posição do vídeo"
            aria-valuemin={0}
            aria-valuemax={Math.round(duracao)}
            aria-valuenow={Math.round(agora)}
            tabIndex={0}
            onPointerDown={buscar}
            onKeyDown={(evento) => {
              const video = videoRef.current;
              if (!video) return;
              if (evento.key === "ArrowRight") video.currentTime = Math.min(duracao, agora + 5);
              if (evento.key === "ArrowLeft") video.currentTime = Math.max(0, agora - 5);
            }}
            className="group/barra relative h-3 cursor-pointer"
          >
            <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/30" />
            <span
              className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-white"
              style={{ width: `${duracao ? (agora / duracao) * 100 : 0}%` }}
            />
            <span
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 transition-opacity group-hover/barra:opacity-100"
              style={{ left: `${duracao ? (agora / duracao) * 100 : 0}%` }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={alternar}
              aria-label={tocando ? "Pausar" : "Tocar"}
              className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-white/15"
            >
              {tocando ? (
                <Pause className="size-4 fill-current" />
              ) : (
                <Play className="size-4 fill-current" />
              )}
            </button>
            <span className="text-[11px] tabular-nums">
              {relogio(agora)} / {relogio(duracao)}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => {
                const video = videoRef.current;
                if (video) video.muted = !video.muted;
              }}
              aria-label={mudo ? "Ativar som" : "Tirar o som"}
              className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-white/15"
            >
              {mudo ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
            <button
              type="button"
              onClick={alternarTelaCheia}
              aria-label={telaCheia ? "Sair da tela cheia" : "Tela cheia"}
              title={telaCheia ? "Sair da tela cheia" : "Tela cheia"}
              className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-white/15"
            >
              {telaCheia ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
            </button>
            <a
              href={url}
              download={fileName ?? "video.mp4"}
              aria-label="Baixar vídeo"
              title="Baixar"
              className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-white/15"
            >
              <Download className="size-4" />
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
