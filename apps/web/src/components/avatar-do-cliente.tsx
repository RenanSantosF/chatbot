"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ImageLightbox } from "@/components/inbox/image-lightbox";
import { avatarColor, initials } from "@/lib/avatar";
import {
  assinarFotos,
  atualizarFoto,
  atualizarFotoNaFila,
  fotoConhecida,
} from "@/lib/fotos-de-perfil";
import { cn } from "@/lib/utils";

/**
 * A foto do WhatsApp do cliente, com as iniciais por baixo.
 *
 * A foto é um `<img>` nativo por cima das iniciais, e não o `AvatarImage`
 * do kit: ele pré-carrega a imagem por JavaScript, o que ignora o
 * `loading="lazy"` — e numa lista de trinta conversas isso baixaria trinta
 * fotos de uma vez, inclusive das linhas que ninguém rolou até ver.
 *
 * As iniciais ficam à vista enquanto a foto carrega e voltam sozinhas
 * quando ela não abre: a URL do WhatsApp expira em alguns dias (ver
 * `Customer.avatarUrl` na API), e cliente que não escreve há tempos cai
 * justamente nesse caso.
 */
export function AvatarDoCliente({
  cliente,
  className,
  textoClassName,
  colorido = true,
  conferir = false,
  conferirAoAparecer = false,
  ampliavel = false,
  tamanho = 48,
}: {
  cliente: { id: string; name: string; avatarUrl?: string | null };
  className?: string;
  /** Tamanho da letra das iniciais. */
  textoClassName?: string;
  /** Iniciais sobre a cor estável do cliente, ou no cinza neutro. */
  colorido?: boolean;
  /**
   * Confere no WhatsApp, ao aparecer, se a foto guardada ainda vale. Só
   * onde UMA conversa está aberta (cabeçalho, ficha) — na lista seriam
   * trinta perguntas de uma vez.
   */
  conferir?: boolean;
  /**
   * Pra lista: busca a foto quando a linha aparece na tela, se não houver
   * foto nenhuma (ou a guardada não abrir), numa fila de poucas por vez.
   */
  conferirAoAparecer?: boolean;
  /** Clicar abre a foto inteira, buscando a versão mais nova. */
  ampliavel?: boolean;
  /** Diâmetro desenhado, em px — é o tamanho em que a miniatura é pedida. */
  tamanho?: number;
}) {
  // A foto buscada nesta aba vale mais que a que veio na resposta da lista:
  // é mais nova (ver `lib/fotos-de-perfil`).
  const buscada = useSyncExternalStore(
    assinarFotos,
    () => fotoConhecida(cliente.id),
    () => undefined,
  );
  const atual = buscada !== undefined ? buscada : (cliente.avatarUrl ?? null);

  // Guarda QUAL url falhou, e não só "falhou": uma URL nova (renovada pela
  // API) merece outra tentativa.
  const [falhou, setFalhou] = useState<string | null>(null);
  const url = atual && atual !== falhou ? atual : null;
  const [ampliada, setAmpliada] = useState<string | null>(null);

  useEffect(() => {
    if (conferir) void atualizarFoto(cliente.id);
  }, [conferir, cliente.id]);

  // Sem foto (ou com uma que não abre — a URL do WhatsApp expira): pede
  // uma nova quando a linha entra na tela. Com foto boa, nada acontece.
  const semFoto = !url;
  const raizRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!conferirAoAparecer || !semFoto) return;
    const alvo = raizRef.current;
    if (!alvo || typeof IntersectionObserver === "undefined") return;
    const observador = new IntersectionObserver((entradas) => {
      if (entradas.some((entrada) => entrada.isIntersecting)) {
        observador.disconnect();
        atualizarFotoNaFila(cliente.id);
      }
    });
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [conferirAoAparecer, semFoto, cliente.id]);

  async function ampliar() {
    // Abre na hora com a foto que já está na tela, e troca pela nova se o
    // WhatsApp devolver outra — esperar a busca pra abrir parecia clique
    // que não funcionou.
    if (url) setAmpliada(url);
    const nova = await atualizarFoto(cliente.id, { forcar: true });
    if (nova) {
      // Se a pessoa já fechou a foto enquanto a busca corria, não reabre.
      setAmpliada((aberta) => (url && aberta === null ? null : nova));
    } else if (!url) {
      toast.info(
        nova === null
          ? "Este contato não tem foto de perfil (ou só mostra pros contatos dele)."
          : "Não deu pra buscar a foto agora.",
      );
    }
  }

  const avatar = (
    <Avatar className={cn(!ampliavel && className, ampliavel && "size-full")}>
      <AvatarFallback
        className={cn(colorido && ["font-medium", avatarColor(cliente.id)], textoClassName)}
      >
        {initials(cliente.name)}
      </AvatarFallback>
      {url ? (
        // Pelo otimizador do Next: chega no tamanho do círculo, e não nos
        // ~640px da original (ver `images` no next.config). A original só
        // é baixada ao ampliar.
        <Image
          src={url}
          alt=""
          fill
          sizes={`${tamanho}px`}
          quality={60}
          onError={() => setFalhou(url)}
          className="rounded-full object-cover"
        />
      ) : null}
    </Avatar>
  );

  if (!ampliavel) {
    return conferirAoAparecer ? (
      // Uma caixa de verdade em volta: o observador de visibilidade não
      // enxerga `display: contents`, que não tem caixa nenhuma.
      <span ref={raizRef} className="flex shrink-0">
        {avatar}
      </span>
    ) : (
      avatar
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void ampliar()}
        aria-label={`Ver a foto de ${cliente.name}`}
        title="Ver foto"
        className={cn(
          "cursor-zoom-in rounded-full transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {avatar}
      </button>
      {ampliada ? (
        <ImageLightbox
          src={ampliada}
          alt={`Foto de ${cliente.name}`}
          fileName={`${cliente.name}.jpg`}
          onClose={() => setAmpliada(null)}
        />
      ) : null}
    </>
  );
}
