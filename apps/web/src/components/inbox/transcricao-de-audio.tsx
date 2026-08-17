"use client";

import { createContext, useContext } from "react";
import type { InboxSettings } from "@/lib/types";

type Modo = InboxSettings["transcricaoDeAudio"];

/**
 * A escolha do dono sobre transcrever áudio, à disposição do balão.
 *
 * Vai por contexto e não por prop porque quem precisa dela é o balão do
 * áudio, quatro níveis abaixo da tela do Inbox — e nenhum dos níveis do
 * meio tem o que fazer com esta informação. Passar de mão em mão só
 * sujaria a assinatura de três componentes.
 *
 * O padrão é SOB_DEMANDA de propósito: atendente não tem permissão de LER
 * as configurações de atendimento, então pra ele a busca falha calada.
 * Falhar pro lado do botão aparecer é o certo — se a empresa desligou de
 * verdade, o servidor recusa o pedido (ver `transcreverAPedido`).
 */
const ContextoDeTranscricao = createContext<Modo>("SOB_DEMANDA");

export function TranscricaoDeAudioProvider({
  modo,
  children,
}: {
  modo: Modo;
  children: React.ReactNode;
}) {
  return (
    <ContextoDeTranscricao.Provider value={modo}>
      {children}
    </ContextoDeTranscricao.Provider>
  );
}

export function useTranscricaoDeAudio(): Modo {
  return useContext(ContextoDeTranscricao);
}
