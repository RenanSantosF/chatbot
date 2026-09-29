"use client";

import {
  Download,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 * canto, e o vídeo toca ali mesmo, sem sair da conversa.
 *
 * Pra ver maior, ele AMPLIA sobre o painel (ver `VideoAmpliado`), e não
 * vai pra tela cheia do sistema: a tela cheia tomava o monitor inteiro,
 * escondia a barra de tarefas e as outras janelas, e pra quem está
 * atendendo isso é sair do trabalho pra ver um vídeo.
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
  const [ampliado, setAmpliado] = useState<{ tempo: number; tocando: boolean } | null>(null);
  const [dimensoes, setDimensoes] = useState<{ largura: number; altura: number } | null>(null);

  function ampliar() {
    const video = videoRef.current;
    // O ampliado continua de onde o do balão estava; o do balão para, pra
    // não tocarem os dois ao mesmo tempo.
    setAmpliado({ tempo: video?.currentTime ?? 0, tocando: Boolean(video && !video.paused) });
    video?.pause();
  }

  return (
    <>
      <Player
        url={url}
        fileName={fileName}
        videoRef={videoRef}
        onFalha={onFalha}
        onDimensoes={setDimensoes}
        onAmpliar={ampliar}
      />
      {ampliado ? (
        <VideoAmpliado
          url={url}
          fileName={fileName}
          inicio={ampliado.tempo}
          tocar={ampliado.tocando}
          dimensoes={dimensoes}
          onFechar={(tempo) => {
            // De volta ao balão no mesmo ponto, parado.
            if (videoRef.current) videoRef.current.currentTime = tempo;
            setAmpliado(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * O vídeo grande, sobre o painel escurecido.
 *
 * Cabe na janela (até 90% da largura e 85% da altura), na proporção dele,
 * e fecha como o visualizador de foto: X, Esc ou clique fora.
 */
function VideoAmpliado({
  url,
  fileName,
  inicio,
  tocar,
  dimensoes,
  onFechar,
}: {
  url: string;
  fileName?: string;
  inicio: number;
  tocar: boolean;
  dimensoes: { largura: number; altura: number } | null;
  onFechar: (tempo: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fechar = () => onFechar(videoRef.current?.currentTime ?? inicio);
  const fecharRef = useRef(fechar);
  useEffect(() => {
    fecharRef.current = fechar;
  });

  useEffect(() => {
    // Esc fecha só esta camada (na captura, como no visualizador de foto:
    // senão o mesmo Esc fechava a conversa junto).
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape") return;
      evento.stopPropagation();
      fecharRef.current();
    };
    document.addEventListener("keydown", aoTeclar, true);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", aoTeclar, true);
      document.body.style.overflow = antes;
    };
  }, []);

  const proporcao = dimensoes ? dimensoes.largura / dimensoes.altura : 16 / 9;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vídeo"
      onClick={fechar}
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/85 p-4 duration-200 animate-in fade-in supports-backdrop-filter:backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={fechar}
        aria-label="Fechar"
        title="Fechar (Esc)"
        className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white"
      >
        <X className="size-5" />
      </button>
      <div
        onClick={(evento) => evento.stopPropagation()}
        style={{
          width: `min(90vw, calc(85vh * ${proporcao}))`,
          aspectRatio: String(proporcao),
        }}
      >
        <Player
          url={url}
          fileName={fileName}
          videoRef={videoRef}
          ampliado
          inicio={inicio}
          tocarAoAbrir={tocar}
          onAmpliar={fechar}
        />
      </div>
    </div>,
    document.body,
  );
}

/** A caixa do vídeo com os controles — a mesma no balão e ampliada. */
function Player({
  url,
  fileName,
  videoRef,
  ampliado = false,
  inicio,
  tocarAoAbrir = false,
  onFalha,
  onDimensoes,
  onAmpliar,
}: {
  url: string;
  fileName?: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  ampliado?: boolean;
  inicio?: number;
  tocarAoAbrir?: boolean;
  onFalha?: () => void;
  onDimensoes?: (dimensoes: { largura: number; altura: number }) => void;
  onAmpliar: () => void;
}) {
  const [proporcao, setProporcao] = useState(1);
  const [tocando, setTocando] = useState(false);
  const [jaTocou, setJaTocou] = useState(ampliado);
  // Ampliado já tocando: o giro aparece enquanto ele carrega, e não o
  // botão de tocar — que sugeriria que é preciso clicar de novo.
  const [esperando, setEsperando] = useState(tocarAoAbrir);
  const [duracao, setDuracao] = useState(0);
  const [agora, setAgora] = useState(inicio ?? 0);
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
      style={ampliado ? undefined : { aspectRatio: `1 / ${proporcao}` }}
      className={cn(
        "group/video relative overflow-hidden bg-black",
        ampliado ? "size-full rounded-lg shadow-2xl" : "w-72 max-w-full rounded-xl",
      )}
    >
      <video
        ref={videoRef}
        // `#t=0.1` faz o navegador desenhar um quadro de verdade como capa,
        // em vez da caixa preta — sem baixar o vídeo inteiro pra isso.
        src={ampliado ? url : `${url}#t=0.1`}
        preload="metadata"
        playsInline
        disablePictureInPicture
        controlsList="nofullscreen nodownload noremoteplayback"
        onLoadedMetadata={(evento) => {
          const video = evento.currentTarget;
          const { videoWidth, videoHeight, duration } = video;
          if (videoWidth && videoHeight) {
            setProporcao(Math.min(Math.max(videoHeight / videoWidth, 0.6), 1.4));
            onDimensoes?.({ largura: videoWidth, altura: videoHeight });
          }
          setDuracao(duration);
          if (ampliado) {
            if (inicio) video.currentTime = inicio;
            if (tocarAoAbrir) void video.play().catch(() => {});
          }
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
        onDoubleClick={onAmpliar}
        className={cn(
          "absolute inset-0 size-full cursor-pointer",
          // Parado, a capa preenche a caixa como uma foto; tocando, o
          // vídeo aparece inteiro, sem corte.
          jaTocou ? "object-contain" : "object-cover",
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
              onClick={onAmpliar}
              aria-label={ampliado ? "Diminuir" : "Ver maior"}
              title={ampliado ? "Diminuir" : "Ver maior"}
              className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-white/15"
            >
              {ampliado ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
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
