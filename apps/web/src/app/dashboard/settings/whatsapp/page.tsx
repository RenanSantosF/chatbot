"use client";

import { Check, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConectarEvolution } from "@/components/settings/conectar-evolution";
import { WhatsAppSettingsCard } from "@/components/settings/whatsapp-settings-card";
import { PageSkeleton } from "@/components/page-skeleton";
import { apiFetch } from "@/lib/api-client";
import type { WhatsAppSettings } from "@/lib/types";

export default function WhatsappSettingsPage() {
  const [whatsapp, setWhatsapp] = useState<WhatsAppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<WhatsAppSettings>("/whatsapp/settings")
      .then(setWhatsapp)
      .catch(() => toast.error("Não deu pra carregar as configurações."))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !whatsapp) {
    return <PageSkeleton rows={2} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <WhatsAppSettingsCard settings={whatsapp} onUpdated={setWhatsapp} />
      {whatsapp.connected ? <PainelDeCoexistencia settings={whatsapp} /> : null}
      {/* Depois do caminho oficial, e não antes: a ordem da tela é a
          recomendação. Quem rolar até aqui já viu qual é o padrão. */}
      <ConectarEvolution />
    </div>
  );
}

function quando(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Estado da coexistência: o mesmo número atendendo pelo celular e por aqui.
 *
 * É painel de leitura, não de configuração — não existe interruptor pra
 * isso do nosso lado. Quem liga é a Meta, no cadastro (Embedded Signup), e
 * a única evidência de que está no ar é ela ter começado a mandar ecos,
 * contatos e histórico. Por isso a tela mostra "o que já chegou" em vez de
 * "ligado/desligado": é o que de fato sabemos.
 */
function PainelDeCoexistencia({ settings }: { settings: WhatsAppSettings }) {
  const co = settings.coexistencia;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-4" />
          Atendimento pelo celular
        </CardTitle>
        <CardDescription>
          Quando o número também está no aplicativo WhatsApp Business, o que a equipe responde pelo
          celular aparece aqui, os contatos da agenda entram na lista de clientes e o histórico
          anterior é importado.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!co?.ativa ? (
          <div className="rounded-md border border-dashed p-3 text-sm">
            <p className="font-medium">Ainda não recebemos nada do celular.</p>
            <p className="mt-1 text-xs text-muted-foreground text-pretty">
              O sistema já sabe tratar mensagens, contatos e histórico vindos do aplicativo — assim
              que a Meta começar a enviá-los, aparecem aqui sozinhos. Ligar isso não é uma opção
              nossa: depende de o número ter sido cadastrado em modo de coexistência junto à Meta.
              Enquanto não estiver, o número funciona só por aqui.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium">Respostas dadas pelo celular</span>
                <span className="block text-xs text-muted-foreground">
                  Chegando desde {quando(co.vistaEm)}. A IA é desligada na conversa quando alguém
                  responde pelo aparelho.
                </span>
              </span>
              <Check className="size-4 shrink-0 text-primary" />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium">Contatos da agenda</span>
                <span className="block text-xs text-muted-foreground">
                  {co.contatos > 0
                    ? `${co.contatos} sincronizado${co.contatos > 1 ? "s" : ""} · último em ${quando(co.contatosSincronizadosEm)}`
                    : "Nenhum contato recebido ainda."}
                </span>
              </span>
              {co.contatos > 0 ? <Check className="size-4 shrink-0 text-primary" /> : null}
            </div>

            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium">Histórico anterior</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {co.historicoProgresso}%
                </span>
              </div>
              {/* Barra simples: a sincronização leva horas e chega picada, e
                  sem um indicador dá a impressão de que travou. */}
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, co.historicoProgresso))}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground text-pretty">
                {co.historicoErro
                  ? co.historicoErro
                  : co.historicoConcluidoEm
                    ? `Concluído em ${quando(co.historicoConcluidoEm)} · ${co.historicoMensagens} mensagens importadas.`
                    : `${co.historicoMensagens} mensagens importadas até agora. A Meta envia em etapas, ao longo de algumas horas.`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground text-pretty">
                Vem até 180 dias de conversa. Conversa em grupo não entra, e anexos com mais de 14
                dias chegam sem o arquivo — só o registro de que existiram.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
