"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { separarLinks } from "@/lib/links";
import { cn } from "@/lib/utils";

interface Previa {
  url: string;
  titulo: string | null;
  descricao: string | null;
  imagem: string | null;
  site: string | null;
}

/**
 * Prévias já pedidas nesta aba. A mesma conversa é aberta várias vezes, e
 * o mesmo link aparece em várias mensagens: cada um é perguntado uma vez.
 */
const pedidas = new Map<string, Promise<Previa | null>>();

function pedir(url: string): Promise<Previa | null> {
  let pedido = pedidas.get(url);
  if (!pedido) {
    pedido = apiFetch<{ previa: Previa | null }>(
      `/link-preview?url=${encodeURIComponent(url)}`,
    )
      .then((r) => r.previa)
      .catch(() => {
        // Falha de rede não fica guardada: a próxima abertura tenta de novo.
        pedidas.delete(url);
        return null;
      });
    pedidas.set(url, pedido);
  }
  return pedido;
}

function realcar(texto: string, termo: string, chave: string) {
  if (!termo) return texto;
  const partes = texto.split(
    new RegExp(`(${termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
  );
  return partes.map((parte, i) =>
    parte.toLowerCase() === termo.toLowerCase() ? (
      <mark
        key={`${chave}-${i}`}
        className="rounded-xs bg-amber-300/70 text-inherit dark:bg-amber-400/40"
      >
        {parte}
      </mark>
    ) : (
      <span key={`${chave}-${i}`}>{parte}</span>
    ),
  );
}

/**
 * O texto da mensagem com os links clicáveis, e o termo da busca realçado.
 *
 * O clique no link não pode virar clique no balão (que abre o menu da
 * mensagem): por isso o `stopPropagation`.
 */
export function TextoComLinks({ texto, termo }: { texto: string; termo: string }) {
  return (
    <>
      {separarLinks(texto).map((pedaco, i) =>
        pedaco.tipo === "link" ? (
          <a
            key={i}
            href={pedaco.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(e) => e.stopPropagation()}
            className="break-all text-[#027eb5] underline decoration-[#027eb5]/40 underline-offset-2 hover:decoration-[#027eb5] dark:text-[#53bdeb] dark:decoration-[#53bdeb]/40"
          >
            {realcar(pedaco.valor, termo, `l${i}`)}
          </a>
        ) : (
          <span key={i}>{realcar(pedaco.valor, termo, `t${i}`)}</span>
        ),
      )}
    </>
  );
}

/**
 * O cartão do link, como o WhatsApp mostra: imagem, título, descrição e o
 * site. Só é pedido quando o balão aparece na tela — uma conversa longa
 * cheia de links não dispara dezenas de buscas ao abrir.
 */
export function CartaoDeLink({ url, fromCustomer }: { url: string; fromCustomer: boolean }) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [imagemQuebrou, setImagemQuebrou] = useState(false);
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const elemento = ref.current;
    if (!elemento) return;
    let vivo = true;
    const observador = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        observador.disconnect();
        void pedir(url).then((achada) => {
          if (vivo) setPrevia(achada);
        });
      },
      { rootMargin: "200px" },
    );
    observador.observe(elemento);
    return () => {
      vivo = false;
      observador.disconnect();
    };
  }, [url]);

  return (
    <a
      ref={ref}
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "block min-w-0 overflow-hidden rounded-md transition-colors",
        // Sem prévia (ainda, ou o site não tem), o cartão não ocupa espaço.
        previa
          ? "mb-1 bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
          : "h-0",
        !fromCustomer && previa && "bg-black/[0.07]",
      )}
      aria-label={previa?.titulo ?? undefined}
    >
      {previa ? (
        <>
          {previa.imagem && !imagemQuebrou ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagem de outro site, sem otimizador configurado pra ela
            <img
              src={previa.imagem}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImagemQuebrou(true)}
              className="max-h-44 w-full object-cover"
            />
          ) : null}
          <span className="block px-2.5 py-1.5">
            <span className="line-clamp-2 text-[13px] font-medium leading-snug">{previa.titulo}</span>
            {previa.descricao ? (
              <span className="mt-0.5 line-clamp-2 text-xs leading-snug opacity-70">
                {previa.descricao}
              </span>
            ) : null}
            {previa.site ? (
              <span className="mt-0.5 block truncate text-[11px] opacity-60">{previa.site}</span>
            ) : null}
          </span>
        </>
      ) : null}
    </a>
  );
}
