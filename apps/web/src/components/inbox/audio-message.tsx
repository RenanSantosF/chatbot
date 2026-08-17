"use client";

import { FileText, Loader2, Mic, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useTranscricaoDeAudio } from "./transcricao-de-audio";

/** Quantas barras a onda tem. Fixo pra todo áudio caber na mesma largura. */
const BARRAS = 40;

/** Velocidades no ciclo do botão, na ordem em que ele avança. */
const VELOCIDADES = [1, 1.5, 2] as const;

function relogio(segundos: number) {
  if (!Number.isFinite(segundos) || segundos < 0) return "0:00";
  const minutos = Math.floor(segundos / 60);
  return `${minutos}:${String(Math.floor(segundos % 60)).padStart(2, "0")}`;
}

/**
 * Onda de reserva, quando não dá pra ler o arquivo.
 *
 * Derivada do id da mídia, não aleatória: a mesma mensagem desenha sempre a
 * mesma onda. Uma onda que muda a cada render faria a conversa parecer
 * instável, e o objetivo aqui é justamente não chamar atenção.
 */
function ondaDeReserva(semente: string): number[] {
  let hash = 0;
  for (let i = 0; i < semente.length; i += 1) {
    hash = (hash * 31 + semente.charCodeAt(i)) >>> 0;
  }
  return Array.from({ length: BARRAS }, (_, i) => {
    hash = (hash * 1103515245 + 12345) >>> 0;
    // Envelope suave nas pontas: fala real começa e termina baixinho.
    const borda = Math.sin((i / (BARRAS - 1)) * Math.PI);
    return 0.25 + (hash % 1000) / 1000 * 0.6 * (0.4 + borda * 0.6);
  });
}

/**
 * Lê o áudio e reduz a picos por barra.
 *
 * O arquivo já está no cache do navegador (o <audio> baixou), então esta
 * segunda leitura não custa rede. Roda uma vez por mensagem e é descartada
 * — não há motivo pra guardar amostras de PCM na memória do painel.
 */
async function extrairOnda(url: string): Promise<number[] | null> {
  try {
    const resposta = await fetch(url, { credentials: "include" });
    if (!resposta.ok) return null;

    const Contexto =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Contexto) return null;

    const contexto = new Contexto();
    const buffer = await contexto.decodeAudioData(await resposta.arrayBuffer());
    void contexto.close();

    const amostras = buffer.getChannelData(0);
    const porBarra = Math.floor(amostras.length / BARRAS) || 1;

    const picos = Array.from({ length: BARRAS }, (_, barra) => {
      let maior = 0;
      const inicio = barra * porBarra;
      // Passo de 16 em 16: numa gravação de 48 kHz isso é mais que
      // suficiente pro pico da barra, e evita percorrer milhões de
      // amostras travando a rolagem da conversa.
      for (let i = inicio; i < inicio + porBarra; i += 16) {
        const valor = Math.abs(amostras[i] ?? 0);
        if (valor > maior) maior = valor;
      }
      return maior;
    });

    // Normaliza pelo pico do próprio áudio: uma gravação baixinha tem que
    // desenhar a mesma altura de uma alta, senão vira um traço reto.
    const teto = Math.max(...picos, 0.01);
    return picos.map((pico) => Math.max(0.12, pico / teto));
  } catch {
    return null;
  }
}

/**
 * Mensagem de voz no formato que todo mundo já sabe usar.
 *
 * O <audio controls> do navegador servia, mas destoava: barra cinza de
 * sistema operacional dentro de um balão de conversa, largura variando a
 * cada mensagem, e um menu de três pontos que abre "baixar" e "velocidade"
 * num lugar onde ninguém procura. Aqui os três gestos que importam —
 * tocar, arrastar, acelerar — estão à vista, e a onda dá a dimensão do
 * recado antes de apertar o play.
 */
export function AudioMessage({
  url,
  chave,
  voz,
  daEmpresa,
  conversationId,
  messageId,
  transcricao,
}: {
  url: string;
  /** Semente da onda de reserva — o id da mídia serve. */
  chave: string;
  /** Gravado no microfone (mensagem de voz) ou arquivo anexado. */
  voz?: boolean;
  /** Muda a paleta: balão verde pede contraste diferente do balão claro. */
  daEmpresa: boolean;
  conversationId: string;
  messageId: string;
  /** O texto do áudio, quando já existe. */
  transcricao?: string | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [tocando, setTocando] = useState(false);
  const [posicao, setPosicao] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [velocidade, setVelocidade] = useState<number>(1);
  const [onda, setOnda] = useState<number[]>(() => ondaDeReserva(chave));
  const modo = useTranscricaoDeAudio();
  const [doBotao, setDoBotao] = useState<string | null>(null);
  const [transcrevendo, setTranscrevendo] = useState(false);

  /*
   * O texto pode vir por dois caminhos, e nenhum espelha o outro.
   *
   * A prop vem do servidor — da IA, do automático, ou do botão de outra
   * pessoa da equipe, chegando por `message.transcrita`. O estado local é
   * a resposta do clique de quem está aqui, que aparece na hora sem
   * depender do evento voltar. A prop tem precedência quando existe: ela é
   * o que está gravado.
   */
  const texto = transcricao ?? doBotao;

  async function transcrever() {
    setTranscrevendo(true);
    try {
      const { transcricao: veio, motivo } = await apiFetch<{
        transcricao: string | null;
        motivo?: string;
      }>(`/conversations/${conversationId}/messages/${messageId}/transcrever`, {
        method: "POST",
      });
      if (veio) setDoBotao(veio);
      else toast.error(motivo ?? "Não deu pra transcrever este áudio.");
    } catch {
      toast.error("Não deu pra transcrever este áudio.");
    } finally {
      setTranscrevendo(false);
    }
  }

  useEffect(() => {
    let vivo = true;
    void extrairOnda(url).then((picos) => {
      if (vivo && picos) setOnda(picos);
    });
    return () => {
      vivo = false;
    };
  }, [url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = velocidade;
  }, [velocidade]);

  const progresso = duracao > 0 ? posicao / duracao : 0;

  function irPara(evento: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    const caixa = evento.currentTarget.getBoundingClientRect();
    const fracao = (evento.clientX - caixa.left) / caixa.width;
    audio.currentTime = Math.min(Math.max(fracao, 0), 1) * audio.duration;
  }

  return (
    <div className="flex w-64 max-w-full flex-col gap-1.5">
    <div className="flex items-center gap-2.5">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={(e) => setDuracao(e.currentTarget.duration || 0)}
        onDurationChange={(e) => setDuracao(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setPosicao(e.currentTarget.currentTime)}
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => {
          setTocando(false);
          setPosicao(0);
        }}
        className="hidden"
      />

      <button
        type="button"
        aria-label={tocando ? "Pausar" : "Tocar"}
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) void audio.play();
          else audio.pause();
        }}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
          daEmpresa
            ? "bg-black/15 text-bubble-out-foreground hover:bg-black/25"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        {tocando ? (
          <Pause className="size-4 fill-current" />
        ) : (
          // Deslocado 1px: o triângulo do play tem o peso visual à
          // esquerda e, centralizado pela caixa, parece torto.
          <Play className="size-4 translate-x-px fill-current" />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          onClick={irPara}
          role="slider"
          aria-label="Posição do áudio"
          aria-valuemin={0}
          aria-valuemax={Math.round(duracao)}
          aria-valuenow={Math.round(posicao)}
          tabIndex={0}
          onKeyDown={(evento) => {
            const audio = audioRef.current;
            if (!audio) return;
            if (evento.key === "ArrowRight") audio.currentTime += 5;
            if (evento.key === "ArrowLeft") audio.currentTime -= 5;
          }}
          className="flex h-7 cursor-pointer items-center gap-px"
        >
          {onda.map((altura, indice) => {
            const passou = indice / BARRAS <= progresso;
            return (
              <span
                key={indice}
                style={{ height: `${Math.round(altura * 100)}%` }}
                className={cn(
                  "min-h-[3px] flex-1 rounded-full transition-colors",
                  passou
                    ? daEmpresa
                      ? "bg-bubble-out-foreground"
                      : "bg-primary"
                    : daEmpresa
                      ? "bg-bubble-out-foreground/30"
                      : "bg-foreground/25",
                )}
              />
            );
          })}
        </div>

        <div
          className={cn(
            "flex items-center gap-2 text-[11px] leading-none",
            daEmpresa ? "text-bubble-out-foreground/70" : "text-muted-foreground",
          )}
        >
          {voz ? <Mic className="size-3 shrink-0" /> : null}
          <span className="tabular-nums">
            {relogio(tocando || posicao > 0 ? posicao : duracao)}
          </span>

          {/* Discreto de propósito: fica na linha dos segundos, do tamanho
              deles, e só existe enquanto há o que transcrever. Depois de
              clicado ele some — o texto embaixo passa a ser a resposta. */}
          {modo !== "DESLIGADA" && !texto ? (
            <button
              type="button"
              title="Transcrever este áudio"
              disabled={transcrevendo}
              onClick={() => void transcrever()}
              className={cn(
                "flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium transition-colors disabled:opacity-60",
                daEmpresa ? "hover:bg-black/15" : "hover:bg-foreground/10",
              )}
            >
              {transcrevendo ? (
                <Loader2 className="size-3 shrink-0 animate-spin" />
              ) : (
                <FileText className="size-3 shrink-0" />
              )}
              {transcrevendo ? "Transcrevendo…" : "Transcrever"}
            </button>
          ) : null}

          {/* Só aparece depois que o áudio começou: um seletor de velocidade
              num áudio que ninguém tocou ainda é ruído. */}
          {posicao > 0 || tocando ? (
            <button
              type="button"
              title="Velocidade"
              onClick={() =>
                setVelocidade(
                  (atual) =>
                    VELOCIDADES[
                      (VELOCIDADES.indexOf(atual as 1) + 1) % VELOCIDADES.length
                    ],
                )
              }
              className={cn(
                "ml-auto rounded-full px-1.5 py-0.5 font-medium tabular-nums transition-colors",
                daEmpresa
                  ? "bg-black/15 hover:bg-black/25"
                  : "bg-foreground/10 hover:bg-foreground/20",
              )}
            >
              {velocidade}×
            </button>
          ) : null}
        </div>
      </div>
    </div>

      {/* A fala em texto, embaixo do player e claramente atrelada a ele.
          Em itálico e com uma barra na lateral porque não é o que o cliente
          escreveu: é o que a máquina entendeu do que ele falou, e a
          diferença tem que estar visível pra quem vai responder. */}
      {texto ? (
        <p
          className={cn(
            "border-l-2 pl-2 text-[13px] leading-snug italic text-pretty",
            daEmpresa
              ? "border-bubble-out-foreground/30 text-bubble-out-foreground/85"
              : "border-foreground/20 text-foreground/85",
          )}
        >
          {texto}
        </p>
      ) : null}
    </div>
  );
}
