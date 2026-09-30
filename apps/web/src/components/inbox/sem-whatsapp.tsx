"use client";

import { ArrowRight, MessageCircleMore, QrCode, Smartphone } from "lucide-react";
import Link from "next/link";
import { useSession } from "@/components/session-provider";

/**
 * O Inbox de quem ainda não conectou o WhatsApp.
 *
 * Antes, sem boas-vindas respondidas, "Conversas" nem abria — piscava e
 * mandava pra visão geral. Agora abre sempre, e é a própria tela que diz
 * por que está vazia: um cartão grande no meio, por cima da lista (que não
 * tem o que mostrar mesmo), com o caminho pra resolver em um clique.
 *
 * Só pra quem NUNCA conectou. Se o WhatsApp cair depois, o histórico
 * continua legível e o aviso é a faixa âmbar do topo (ver CanalCaido) —
 * tampar as conversas justo quando a pessoa precisa consultá-las seria pior.
 */
export function SemWhatsApp() {
  const { user } = useSession();
  const podeConectar = user.role === "OWNER" || user.role === "ADMIN";

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 p-6 backdrop-blur-[3px]">
      <div className="cadastro-entra flex w-full max-w-md flex-col items-center gap-6 rounded-3xl border bg-card p-8 text-center shadow-[0_30px_80px_-30px_oklch(0_0_0/45%)]">
        <div className="relative">
          <span className="tour-pulso absolute inset-0 rounded-3xl" aria-hidden />
          <span className="relative flex size-16 items-center justify-center rounded-3xl bg-primary/10 text-primary">
            <Smartphone className="size-8" />
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-balance">
            Nenhum WhatsApp conectado ainda
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            {podeConectar
              ? "As conversas aparecem aqui assim que o WhatsApp da empresa estiver ligado ao painel. Leva menos de um minuto: é só ler um QR code com o celular."
              : "As conversas aparecem aqui assim que o dono da conta conectar o WhatsApp da empresa. Até lá, não há mensagens pra ver nem responder."}
          </p>
        </div>
        {podeConectar ? (
          <>
            <ol className="flex w-full flex-col gap-2 text-left text-sm">
              {[
                { icone: QrCode, texto: "Abra a tela de conexão e gere o QR code" },
                { icone: Smartphone, texto: "No celular: WhatsApp → Aparelhos conectados → Conectar" },
                { icone: MessageCircleMore, texto: "Pronto — as conversas começam a chegar aqui" },
              ].map((passo, i) => (
                <li key={passo.texto} className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">{passo.texto}</span>
                  <passo.icone className="size-4 shrink-0 text-muted-foreground" />
                </li>
              ))}
            </ol>
            <Link
              href="/dashboard/settings/whatsapp"
              className="group inline-flex h-11 items-center gap-2 rounded-full bg-primary pr-4 pl-6 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              Conectar o WhatsApp
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
