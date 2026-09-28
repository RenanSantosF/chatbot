"use client";

import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { avatarColor, initials } from "@/lib/avatar";
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
}: {
  cliente: { id: string; name: string; avatarUrl?: string | null };
  className?: string;
  /** Tamanho da letra das iniciais. */
  textoClassName?: string;
  /** Iniciais sobre a cor estável do cliente, ou no cinza neutro. */
  colorido?: boolean;
}) {
  // Guarda QUAL url falhou, e não só "falhou": uma URL nova (renovada pela
  // API) merece outra tentativa.
  const [falhou, setFalhou] = useState<string | null>(null);
  const url = cliente.avatarUrl && cliente.avatarUrl !== falhou ? cliente.avatarUrl : null;

  return (
    <Avatar className={className}>
      <AvatarFallback
        className={cn(colorido && ["font-medium", avatarColor(cliente.id)], textoClassName)}
      >
        {initials(cliente.name)}
      </AvatarFallback>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL externa que expira; o otimizador do Next guardaria cópia de algo que muda.
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFalhou(url)}
          className="absolute inset-0 size-full rounded-full object-cover"
        />
      ) : null}
    </Avatar>
  );
}
