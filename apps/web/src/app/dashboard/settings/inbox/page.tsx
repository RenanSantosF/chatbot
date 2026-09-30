"use client";

import { AudioLines, MessageSquareHeart, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BusinessHoursCard } from "@/components/settings/business-hours-card";
import { QuickRepliesCard } from "@/components/settings/quick-replies-card";
import { TagsCard } from "@/components/settings/tags-card";
import { PageSkeleton } from "@/components/page-skeleton";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { AiSettings, InboxSettings } from "@/lib/types";

export default function InboxSettingsPage() {
  const [settings, setSettings] = useState<InboxSettings | null>(null);
  const [message, setMessage] = useState("");
  const [savingMessage, setSavingMessage] = useState(false);
  const [despedida, setDespedida] = useState("");
  const [salvandoDespedida, setSalvandoDespedida] = useState(false);
  const [saudacao, setSaudacao] = useState("");
  const [salvandoSaudacao, setSalvandoSaudacao] = useState(false);
  // A IA vive noutra tela de configurações — sem isto, dava pra deixar os
  // dois interruptores "ligados" aqui e lá, mesmo sabendo (pela descrição
  // do card) que a saudação nunca sai enquanto a IA responde. Ligados os
  // dois na TELA é que confundia, mesmo sem efeito prático nenhum.
  const [iaAtiva, setIaAtiva] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<InboxSettings>("/inbox-settings"),
      apiFetch<AiSettings>("/ai/settings").catch(() => null),
    ])
      .then(async ([result, ai]) => {
        setMessage(result.resolveMessage);
        setDespedida(result.autoCloseMessage);
        setSaudacao(result.greetingMessage);
        setIaAtiva(ai?.active ?? false);

        // Estado que só existia porque a IA foi ligada DEPOIS de a
        // saudação já estar configurada — os dois nunca fazem sentido
        // juntos, então corrige sozinho em vez de deixar a tela mostrar
        // um "ligado" que nunca dispara.
        if (result.greetingEnabled && ai?.active) {
          const corrigido = await apiFetch<InboxSettings>("/inbox-settings", {
            method: "PATCH",
            body: JSON.stringify({ greetingEnabled: false }),
          }).catch(() => null);
          setSettings(corrigido ?? result);
          if (corrigido) {
            toast.info(
              "A resposta automática ao primeiro contato foi desligada porque a IA está ativa.",
            );
          }
          return;
        }
        setSettings(result);
      })
      .catch(() => toast.error("Não deu pra carregar as configurações."));
  }, []);

  async function patch(body: Partial<InboxSettings>) {
    try {
      const updated = await apiFetch<InboxSettings>("/inbox-settings", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setSettings(updated);
      return updated;
    } catch {
      toast.error("Não deu pra salvar.");
      return null;
    }
  }

  async function salvarSaudacao() {
    setSalvandoSaudacao(true);
    const updated = await patch({ greetingMessage: saudacao.trim() });
    if (updated) toast.success("Mensagem de boas-vindas salva.");
    setSalvandoSaudacao(false);
  }

  async function handleSaveMessage() {
    setSavingMessage(true);
    const updated = await patch({ resolveMessage: message.trim() });
    if (updated) toast.success("Mensagem de encerramento salva.");
    setSavingMessage(false);
  }

  if (!settings) return <PageSkeleton rows={2} />;

  /*
   * A página diz pouco, de propósito.
   *
   * Cada interruptor era um cartão com parágrafo de justificativa — nove
   * cartões pra ler antes de achar o que se queria mudar. Agora os
   * interruptores simples moram juntos, cada um com UMA linha dizendo o
   * que acontece, e o texto de campo só aparece quando o interruptor
   * está ligado.
   */
  return (
    <div className="flex flex-col gap-4">
      <BusinessHoursCard
        value={settings.businessHours}
        onSave={async (semana) => {
          const atualizada = await patch({ businessHours: semana });
          if (atualizada) toast.success("Horário de atendimento salvo.");
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareHeart className="size-4" />
            Mensagens automáticas
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          <Opcao
            titulo="Boas-vindas no primeiro contato"
            descricao={
              iaAtiva
                ? "Desligada porque a IA já responde."
                : "Enviada uma vez, quando alguém escreve pela primeira vez."
            }
            ligada={settings.greetingEnabled}
            onChange={(ligada) => patch({ greetingEnabled: ligada })}
            desabilitada={iaAtiva}
          >
            {settings.greetingEnabled ? (
              <CampoDeMensagem
                id="greeting-message"
                valor={saudacao}
                salvo={settings.greetingMessage}
                onChange={setSaudacao}
                salvando={salvandoSaudacao}
                onSalvar={salvarSaudacao}
                placeholder="Olá! Um atendente já vai falar com você."
              />
            ) : null}
          </Opcao>

          <Opcao
            titulo="Aviso ao resolver"
            descricao="O cliente fica sabendo que o atendimento foi encerrado."
            ligada={settings.notifyOnResolve}
            onChange={(ligada) => patch({ notifyOnResolve: ligada })}
          >
            {settings.notifyOnResolve ? (
              <CampoDeMensagem
                id="resolve-message"
                valor={message}
                salvo={settings.resolveMessage}
                onChange={setMessage}
                salvando={savingMessage}
                onSalvar={handleSaveMessage}
              />
            ) : null}
          </Opcao>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="size-4" />
            Conversas
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          <Opcao
            titulo="Marcar como lida ao abrir"
            descricao="O cliente vê o tique azul quando alguém da equipe abre a conversa."
            ligada={settings.sendReadReceipts}
            onChange={(ligada) => patch({ sendReadReceipts: ligada })}
          />
          <Opcao
            titulo="Mostrar o nome do atendente"
            descricao={
              <>
                Chega assim:{" "}
                {settings.showAgentName ? (
                  <strong className="text-foreground">Renan: </strong>
                ) : null}
                Bom dia, já verifiquei aqui.
              </>
            }
            ligada={settings.showAgentName}
            onChange={(ligada) => patch({ showAgentName: ligada })}
          />
          <Opcao
            titulo="Juntar as conversas do mesmo cliente"
            descricao="Quem volta a escrever cai na mesma conversa, com o histórico à vista."
            ligada={settings.groupByCustomer}
            onChange={(ligada) => patch({ groupByCustomer: ligada })}
          />
          <Opcao
            titulo="Responder em conversa encerrada"
            descricao="Responder reabre o atendimento sozinho."
            ligada={settings.allowSendWhenResolved}
            onChange={(ligada) => patch({ allowSendWhenResolved: ligada })}
          />
          <Opcao
            titulo="Cada um vê só o próprio setor"
            descricao="Dono e administradores continuam vendo tudo."
            ligada={settings.queueVisibility === "OWN_QUEUES"}
            onChange={(ligada) => patch({ queueVisibility: ligada ? "OWN_QUEUES" : "ALL" })}
          />
          <Opcao
            titulo="Encerrar conversas paradas"
            descricao="Resolve sozinho depois de um tempo sem movimento."
            ligada={settings.autoCloseIdle}
            onChange={(ligada) => patch({ autoCloseIdle: ligada })}
          >
            {settings.autoCloseIdle ? (
              <div className="flex flex-col gap-3 border-l-2 pl-3">
                <NumberField
                  id="auto-close"
                  sufixo="horas"
                  value={settings.autoCloseHours}
                  min={1}
                  max={23}
                  onSave={(valor) => patch({ autoCloseHours: valor })}
                />
                <label className="flex items-center justify-between gap-4">
                  <span className="text-sm">Avisar o cliente ao encerrar</span>
                  <Switch
                    checked={settings.autoCloseNotify}
                    onCheckedChange={(checked) => patch({ autoCloseNotify: checked })}
                    aria-label="Avisar o cliente ao encerrar por inatividade"
                  />
                </label>
                {settings.autoCloseNotify ? (
                  <CampoDeMensagem
                    id="auto-close-message"
                    valor={despedida}
                    salvo={settings.autoCloseMessage}
                    onChange={setDespedida}
                    salvando={salvandoDespedida}
                    onSalvar={async () => {
                      setSalvandoDespedida(true);
                      const atualizada = await patch({ autoCloseMessage: despedida.trim() });
                      if (atualizada) toast.success("Mensagem de despedida salva.");
                      setSalvandoDespedida(false);
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </Opcao>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AudioLines className="size-4" />
            Transcrever áudio do cliente
          </CardTitle>
          <CardDescription>
            Nas conversas com a equipe. Com a IA, o áudio é sempre transcrito.
          </CardDescription>
        </CardHeader>
        <CardContent
          className="grid gap-2 sm:grid-cols-3"
          role="radiogroup"
          aria-label="Transcrever áudio do cliente"
        >
          <OpcaoDeTranscricao
            ativa={settings.transcricaoDeAudio === "SOB_DEMANDA"}
            onClick={() => patch({ transcricaoDeAudio: "SOB_DEMANDA" })}
            titulo="Quando pedir"
            descricao="Um botão no áudio transcreve."
          />
          <OpcaoDeTranscricao
            ativa={settings.transcricaoDeAudio === "AUTOMATICA"}
            onClick={() => patch({ transcricaoDeAudio: "AUTOMATICA" })}
            titulo="Sempre"
            descricao="Todo áudio já chega com o texto."
          />
          <OpcaoDeTranscricao
            ativa={settings.transcricaoDeAudio === "DESLIGADA"}
            onClick={() => patch({ transcricaoDeAudio: "DESLIGADA" })}
            titulo="Nunca"
            descricao="A equipe ouve o áudio."
          />
        </CardContent>
      </Card>

      <QuickRepliesCard />

      <TagsCard />
    </div>
  );
}

/**
 * Uma linha de configuração: título, uma frase e o interruptor. O que
 * depende dela (a mensagem, o prazo) aparece logo abaixo, quando ligada.
 */
function Opcao({
  titulo,
  descricao,
  ligada,
  onChange,
  desabilitada = false,
  children,
}: {
  titulo: string;
  descricao: React.ReactNode;
  ligada: boolean;
  onChange: (ligada: boolean) => void;
  desabilitada?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
      <label className={cn("flex items-center justify-between gap-4", desabilitada && "opacity-60")}>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{titulo}</span>
          <span className="block text-xs text-muted-foreground text-pretty">{descricao}</span>
        </span>
        <Switch
          checked={ligada}
          onCheckedChange={onChange}
          disabled={desabilitada}
          aria-label={titulo}
        />
      </label>
      {children}
    </div>
  );
}

/** O texto que sai pro cliente, com o salvar próprio. */
function CampoDeMensagem({
  id,
  valor,
  salvo,
  onChange,
  salvando,
  onSalvar,
  placeholder,
}: {
  id: string;
  valor: string;
  salvo: string;
  onChange: (valor: string) => void;
  salvando: boolean;
  onSalvar: () => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        id={id}
        rows={2}
        value={valor}
        onChange={(event) => onChange(event.target.value)}
        maxLength={1000}
        placeholder={placeholder}
        aria-label="Mensagem enviada"
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={onSalvar}
          disabled={salvando || valor.trim().length < 5 || valor.trim() === salvo}
        >
          {salvando ? <Spinner /> : null}
          Salvar mensagem
        </Button>
        <span className="text-xs text-muted-foreground">{valor.length}/1000</span>
      </div>
    </div>
  );
}

/**
 * Campo numérico com salvar próprio. Não salva a cada tecla de propósito:
 * digitar "12" passa por "1", e salvar o "1" mudaria a configuração pra um
 * valor que ninguém escolheu.
 */
function NumberField({
  id,
  sufixo,
  value,
  min,
  max,
  onSave,
}: {
  id: string;
  sufixo: string;
  value: number;
  min: number;
  max: number;
  onSave: (valor: number) => Promise<unknown>;
}) {
  const [rascunho, setRascunho] = useState(String(value));
  const [salvando, setSalvando] = useState(false);

  const numero = Number(rascunho);
  const valido = Number.isInteger(numero) && numero >= min && numero <= max;
  const mudou = valido && numero !== value;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm whitespace-nowrap text-muted-foreground">Depois de</span>
        <Input
          id={id}
          aria-label="Horas sem movimento"
          type="number"
          min={min}
          max={max}
          value={rascunho}
          onChange={(event) => setRascunho(event.target.value)}
          className="h-9 w-20"
        />
        <span className="text-sm whitespace-nowrap text-muted-foreground">{sufixo}</span>
        <Button
          size="sm"
          variant="outline"
          disabled={!mudou || salvando}
          onClick={async () => {
            setSalvando(true);
            await onSave(numero);
            setSalvando(false);
          }}
        >
          {salvando ? <Spinner /> : null}
          Salvar
        </Button>
      </div>
      {!valido ? (
        <p className="text-xs text-destructive">
          Informe um número inteiro entre {min} e {max}.
        </p>
      ) : null}
    </div>
  );
}

/** Uma das três escolhas de transcrição, lado a lado, com a atual acesa. */
function OpcaoDeTranscricao({
  ativa,
  onClick,
  titulo,
  descricao,
}: {
  ativa: boolean;
  onClick: () => void;
  titulo: string;
  descricao: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativa}
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
        ativa ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          ativa ? "border-primary" : "border-muted-foreground/40",
        )}
      >
        {ativa ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{titulo}</span>
        <span className="block text-xs text-muted-foreground text-pretty">{descricao}</span>
      </span>
    </button>
  );
}
