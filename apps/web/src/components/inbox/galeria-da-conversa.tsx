"use client";

import { ExternalLink, FileText, ImageOff, Link2, MessageSquareText, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";
import { tamanhoLegivel } from "@/lib/armazenamento";
import type { MessageMetadata, MessageType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ImageLightbox } from "./image-lightbox";

type Tipo = "MIDIA" | "DOCUMENTO" | "AUDIO" | "LINK";

interface ItemDaGaleria {
  id: string;
  content: string;
  messageType: MessageType;
  metadata: MessageMetadata | null;
  senderType: string;
  createdAt: string;
}

interface PaginaDaGaleria {
  tipo: Tipo;
  items: ItemDaGaleria[];
  nextCursor: string | null;
  contagens: Record<Tipo, number>;
}

const ABAS: { id: Tipo; rotulo: string }[] = [
  { id: "MIDIA", rotulo: "Mídia" },
  { id: "DOCUMENTO", rotulo: "Documentos" },
  { id: "AUDIO", rotulo: "Áudios" },
  { id: "LINK", rotulo: "Links" },
];

/** O mesmo proxy autenticado que o balão usa (ver message-attachment). */
function urlDaMidia(mediaId: string, largura?: number) {
  const base = `/api/whatsapp/media/${encodeURIComponent(mediaId)}`;
  return largura ? `${base}?w=${largura}` : base;
}

function dataCurta(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function linksDo(texto: string): string[] {
  return texto.match(/https?:\/\/[^\s<>"')]+/gi) ?? [];
}

/**
 * "Mídia, documentos e links" da conversa — como no WhatsApp.
 *
 * O painel guarda tudo o que chega (fotos, vídeos, documentos, áudios),
 * e isso só vale alguma coisa se dá pra achar sem rolar a conversa
 * inteira. Cada item leva de volta ao ponto da conversa em que apareceu.
 */
export function GaleriaDaConversa({
  conversationId,
  aberta,
  onFechar,
  onIrParaMensagem,
}: {
  conversationId: string;
  aberta: boolean;
  onFechar: () => void;
  onIrParaMensagem: (messageId: string) => void;
}) {
  const [tipo, setTipo] = useState<Tipo>("MIDIA");
  const [itens, setItens] = useState<ItemDaGaleria[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [contagens, setContagens] = useState<Partial<Record<Tipo, number>>>({});
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [ampliada, setAmpliada] = useState<ItemDaGaleria | null>(null);
  // Miniaturas que voltaram erro: o arquivo não existe mais em lugar nenhum.
  const [indisponiveis, setIndisponiveis] = useState<Set<string>>(() => new Set());

  const buscar = useCallback(
    async (qual: Tipo, depoisDe?: string | null) => {
      const params = new URLSearchParams({ tipo: qual });
      if (depoisDe) params.set("cursor", depoisDe);
      return apiFetch<PaginaDaGaleria>(
        `/conversations/${conversationId}/midias?${params.toString()}`,
      );
    },
    [conversationId],
  );

  useEffect(() => {
    if (!aberta) return;
    let cancelado = false;
    buscar(tipo)
      .then((pagina) => {
        if (cancelado) return;
        setItens(pagina.items);
        setCursor(pagina.nextCursor);
        setContagens(pagina.contagens);
      })
      .catch(() => {
        if (!cancelado) setItens([]);
      });
    return () => {
      cancelado = true;
    };
  }, [aberta, tipo, buscar]);

  async function carregarMais() {
    if (!cursor || carregandoMais) return;
    setCarregandoMais(true);
    try {
      const pagina = await buscar(tipo, cursor);
      setItens((atuais) => [...(atuais ?? []), ...pagina.items]);
      setCursor(pagina.nextCursor);
    } finally {
      setCarregandoMais(false);
    }
  }

  function trocarDeAba(proxima: Tipo) {
    if (proxima === tipo) return;
    setItens(null);
    setCursor(null);
    setTipo(proxima);
  }

  function irPara(id: string) {
    onFechar();
    onIrParaMensagem(id);
  }

  return (
    <>
      <Sheet open={aberta} onOpenChange={(abrir) => !abrir && onFechar()}>
        <SheetContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <SheetHeader className="shrink-0">
            <SheetTitle>Mídia, documentos e links</SheetTitle>
            <SheetDescription>Tudo o que foi trocado nesta conversa.</SheetDescription>
          </SheetHeader>

          <div role="tablist" className="flex shrink-0 gap-0.5 border-b px-2">
            {ABAS.map((aba) => {
              const ativa = aba.id === tipo;
              const quantos = contagens[aba.id];
              return (
                <button
                  key={aba.id}
                  type="button"
                  role="tab"
                  aria-selected={ativa}
                  onClick={() => trocarDeAba(aba.id)}
                  className={cn(
                    "flex grow items-center justify-center gap-1 border-b-2 pt-1 pb-2.5 text-xs font-medium transition-colors",
                    ativa
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {aba.rotulo}
                  {quantos ? (
                    <span className="text-[10px] tabular-nums opacity-70">{quantos}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {itens === null ? (
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 9 }, (_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-md" />
                ))}
              </div>
            ) : itens.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground text-pretty">
                {tipo === "MIDIA"
                  ? "Nenhuma foto ou vídeo nesta conversa ainda."
                  : tipo === "DOCUMENTO"
                    ? "Nenhum documento nesta conversa ainda."
                    : tipo === "AUDIO"
                      ? "Nenhum áudio nesta conversa ainda."
                      : "Nenhum link nesta conversa ainda."}
              </p>
            ) : tipo === "MIDIA" ? (
              <div className="grid grid-cols-3 gap-1.5">
                {itens.map((item) => {
                  const mediaId = item.metadata?.mediaId;
                  const video = item.messageType === "VIDEO";
                  const indisponivel = Boolean(mediaId && indisponiveis.has(mediaId));
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={
                        indisponivel
                          ? `${dataCurta(item.createdAt)} — o WhatsApp não tem mais este arquivo`
                          : dataCurta(item.createdAt)
                      }
                      onClick={() =>
                        video || !mediaId || indisponivel ? irPara(item.id) : setAmpliada(item)
                      }
                      className="group relative aspect-square overflow-hidden rounded-md bg-muted"
                    >
                      {indisponivel ? (
                        <span className="flex size-full flex-col items-center justify-center gap-1 px-2 text-center text-muted-foreground">
                          <ImageOff className="size-5" />
                          <span className="text-[10px] leading-tight">Indisponível</span>
                        </span>
                      ) : mediaId && !video ? (
                        // eslint-disable-next-line @next/next/no-img-element -- vem do nosso proxy, já redimensionado
                        <img
                          src={urlDaMidia(mediaId, 320)}
                          alt=""
                          loading="lazy"
                          // O arquivo que o WhatsApp já apagou (ou que nunca
                          // foi guardado) volta 404: em vez do ícone de
                          // imagem quebrada, um quadro que diz o que houve.
                          onError={() =>
                            setIndisponiveis((atual) => new Set(atual).add(mediaId))
                          }
                          className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center bg-foreground/80 text-background">
                          <Play className="size-6" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {itens.map((item) => (
                  <li key={item.id}>
                    <LinhaDaGaleria item={item} tipo={tipo} onIrPara={() => irPara(item.id)} />
                  </li>
                ))}
              </ul>
            )}

            {cursor ? (
              <div className="flex justify-center pt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={carregandoMais}
                  onClick={() => void carregarMais()}
                >
                  {carregandoMais ? <Spinner className="size-3.5" /> : null}
                  Carregar mais
                </Button>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {ampliada?.metadata?.mediaId ? (
        <ImageLightbox
          src={urlDaMidia(ampliada.metadata.mediaId)}
          alt=""
          fileName={ampliada.metadata.fileName}
          onClose={() => setAmpliada(null)}
        />
      ) : null}
    </>
  );
}

/** Documento, áudio ou link: uma linha com o que é, de quando, e os atalhos. */
function LinhaDaGaleria({
  item,
  tipo,
  onIrPara,
}: {
  item: ItemDaGaleria;
  tipo: Tipo;
  onIrPara: () => void;
}) {
  const mediaId = item.metadata?.mediaId;
  const deQuem = item.senderType === "CUSTOMER" ? "Cliente" : "Empresa";

  return (
    <div className="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted/60">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {tipo === "LINK" ? <Link2 className="size-4" /> : <FileText className="size-4" />}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {tipo === "DOCUMENTO" ? (
          <span className="truncate text-sm font-medium">
            {item.metadata?.fileName || item.content || "Documento"}
          </span>
        ) : tipo === "AUDIO" && mediaId ? (
          <audio controls preload="none" src={urlDaMidia(mediaId)} className="h-8 w-full" />
        ) : tipo === "LINK" ? (
          <div className="flex flex-col gap-0.5">
            {linksDo(item.content).map((link) => (
              <a
                key={link}
                href={link}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 truncate text-sm text-primary hover:underline"
              >
                <span className="truncate">{link}</span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
            ))}
          </div>
        ) : null}

        <span className="text-[11px] text-muted-foreground">
          {deQuem} · {dataCurta(item.createdAt)}
          {tipo === "DOCUMENTO" && item.metadata?.size
            ? ` · ${tamanhoLegivel(item.metadata.size)}`
            : null}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {tipo === "DOCUMENTO" && mediaId ? (
          <Button
            size="icon-sm"
            variant="ghost"
            title="Abrir"
            aria-label="Abrir o documento"
            render={<a href={urlDaMidia(mediaId)} target="_blank" rel="noreferrer" />}
          >
            <ExternalLink className="size-4" />
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          title="Ver na conversa"
          aria-label="Ver na conversa"
          onClick={onIrPara}
        >
          <MessageSquareText className="size-4" />
        </Button>
      </div>
    </div>
  );
}
