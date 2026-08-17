"use client";

import {
  AudioLines,
  CheckCheck,
  Clock,
  Eye,
  Layers,
  MessageSquareHeart,
  MessageSquareX,
  PenLine,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BusinessHoursCard } from "@/components/settings/business-hours-card";
import { QuickRepliesCard } from "@/components/settings/quick-replies-card";
import { TagsCard } from "@/components/settings/tags-card";
import { PageSkeleton } from "@/components/page-skeleton";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { InboxSettings } from "@/lib/types";

export default function InboxSettingsPage() {
  const [settings, setSettings] = useState<InboxSettings | null>(null);
  const [message, setMessage] = useState("");
  const [savingMessage, setSavingMessage] = useState(false);
  const [despedida, setDespedida] = useState("");
  const [salvandoDespedida, setSalvandoDespedida] = useState(false);
  const [saudacao, setSaudacao] = useState("");
  const [salvandoSaudacao, setSalvandoSaudacao] = useState(false);

  useEffect(() => {
    apiFetch<InboxSettings>("/inbox-settings")
      .then((result) => {
        setSettings(result);
        setMessage(result.resolveMessage);
        setDespedida(result.autoCloseMessage);
        setSaudacao(result.greetingMessage);
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

  return (
    <div className="flex flex-col gap-4">
      <BusinessHoursCard
        value={settings.businessHours}
        onSave={async (semana) => {
          const atualizada = await patch({ businessHours: semana });
          if (atualizada) toast.success("Horário de atendimento salvo.");
        }}
      />

      <QuickRepliesCard />

      <TagsCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCheck className="size-4" />
            Confirmação de leitura
          </CardTitle>
          <CardDescription>
            Quando ligada, abrir a conversa no painel acende o tique azul no aparelho do cliente — ele vê
            que a mensagem foi lida.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Marcar mensagens como lidas</span>
              <span className="block text-xs text-muted-foreground text-pretty">
                Desligue se preferir que o cliente não saiba que a mensagem já foi vista antes de a equipe
                conseguir responder.
              </span>
            </span>
            <Switch
              checked={settings.sendReadReceipts}
              onCheckedChange={(checked) => patch({ sendReadReceipts: checked })}
              aria-label="Enviar confirmação de leitura"
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareHeart className="size-4" />
            Primeira resposta automática
          </CardTitle>
          <CardDescription>
            Quando alguém escreve pela primeira vez, o cliente recebe esta mensagem na hora e a
            conversa entra na fila para um atendente. Não depende de IA — serve justamente para
            quem ainda não configurou uma. Sai uma vez por conversa, e fica em silêncio quando a
            IA está respondendo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span className="text-sm font-medium">Responder automaticamente ao primeiro contato</span>
            <Switch
              checked={settings.greetingEnabled}
              onCheckedChange={(checked) => patch({ greetingEnabled: checked })}
              aria-label="Responder ao primeiro contato"
            />
          </label>

          {settings.greetingEnabled ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="greeting-message" className="text-xs">
                Mensagem enviada
              </Label>
              <Textarea
                id="greeting-message"
                rows={3}
                value={saudacao}
                onChange={(event) => setSaudacao(event.target.value)}
                maxLength={1000}
                placeholder="Olá! Somos do Escritório Ferreira Cleto Advogados. Um atendente já vai falar com você."
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={salvarSaudacao}
                  disabled={
                    salvandoSaudacao ||
                    saudacao.trim().length < 5 ||
                    saudacao.trim() === settings.greetingMessage
                  }
                >
                  {salvandoSaudacao ? <Spinner /> : null}
                  Salvar mensagem
                </Button>
                <span className="text-xs text-muted-foreground">{saudacao.length}/1000</span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareX className="size-4" />
            Aviso de encerramento
          </CardTitle>
          <CardDescription>
            Ao clicar em &ldquo;Resolver&rdquo;, o cliente recebe esta mensagem avisando que o atendimento
            foi encerrado — sem ela, ele fica esperando uma resposta que não vem.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span className="text-sm font-medium">Avisar o cliente ao resolver</span>
            <Switch
              checked={settings.notifyOnResolve}
              onCheckedChange={(checked) => patch({ notifyOnResolve: checked })}
              aria-label="Avisar ao resolver"
            />
          </label>

          {settings.notifyOnResolve ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="resolve-message" className="text-xs">
                Mensagem enviada
              </Label>
              <Textarea
                id="resolve-message"
                rows={3}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={1000}
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveMessage}
                  disabled={
                    savingMessage ||
                    message.trim().length < 5 ||
                    message.trim() === settings.resolveMessage
                  }
                >
                  {savingMessage ? <Spinner /> : null}
                  Salvar mensagem
                </Button>
                <span className="text-xs text-muted-foreground">{message.length}/1000</span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Undo2 className="size-4" />
            Responder em conversa encerrada
          </CardTitle>
          <CardDescription>
            Do lado do cliente não existe &ldquo;encerrado&rdquo;: existe uma conversa de WhatsApp
            como qualquer outra. Com isto ligado, responder reabre o atendimento sozinho e o
            histórico registra quem reabriu. Desligado, é preciso reabrir de propósito antes de
            escrever — o que faz sentido em operação com auditoria, onde reabrir precisa ser um
            ato deliberado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span className="text-sm font-medium">Deixar responder e reabrir</span>
            <Switch
              checked={settings.allowSendWhenResolved}
              onCheckedChange={(checked) => patch({ allowSendWhenResolved: checked })}
              aria-label="Deixar responder em conversa encerrada"
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PenLine className="size-4" />
            Assinar as respostas
          </CardTitle>
          <CardDescription>
            Coloca o primeiro nome de quem respondeu, em negrito, antes do texto que chega no
            aparelho do cliente. No painel o nome sempre aparece no balão — isto decide só o que o
            cliente vê.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Mostrar o nome do atendente</span>
              <span className="block text-xs text-muted-foreground text-pretty">
                Ligue se quiser que o cliente saiba com quem falou. Desligado, a empresa fala como
                uma voz só. A IA nunca assina — ela já se apresenta pelo nome configurado.
              </span>
            </span>
            <Switch
              checked={settings.showAgentName}
              onCheckedChange={(checked) => patch({ showAgentName: checked })}
              aria-label="Assinar mensagens com o nome do atendente"
            />
          </label>
          <p className="rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
            Como chega:{" "}
            {settings.showAgentName ? (
              <>
                <strong className="text-foreground">Renan:</strong> Bom dia, já verifiquei aqui.
              </>
            ) : (
              "Bom dia, já verifiquei aqui."
            )}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="size-4" />
            Quem vê quais conversas
          </CardTitle>
          <CardDescription>
            Em equipe pequena todo mundo ver tudo funciona melhor. Quando há setores com assuntos
            separados, restringir evita que o financeiro leia conversa do jurídico.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Cada um vê só o próprio setor</span>
              <span className="block text-xs text-muted-foreground text-pretty">
                Conversa sem setor e conversa atribuída à própria pessoa continuam visíveis pra
                todos — senão ficariam sem atendimento. Dono e admin veem tudo de qualquer forma.
              </span>
            </span>
            <Switch
              checked={settings.queueVisibility === "OWN_QUEUES"}
              onCheckedChange={(checked) =>
                patch({ queueVisibility: checked ? "OWN_QUEUES" : "ALL" })
              }
              aria-label="Restringir visibilidade por setor"
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AudioLines className="size-4" />
            Transcrever áudio do cliente
          </CardTitle>
          <CardDescription>
            Vale pro atendimento humano. Quando quem responde é a IA, o áudio é sempre
            transcrito — sem ouvir ela não teria o que responder —, e essa transcrição
            aparece no balão pra todo mundo. Aqui você decide o que acontece nas conversas
            que estão com a equipe. Cada transcrição é uma consulta à IA, cobrada na sua
            conta.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2" role="radiogroup" aria-label="Transcrever áudio do cliente">
          <OpcaoDeTranscricao
            ativa={settings.transcricaoDeAudio === "SOB_DEMANDA"}
            onClick={() => patch({ transcricaoDeAudio: "SOB_DEMANDA" })}
            titulo="O atendente decide"
            descricao="Aparece um botão discreto no balão do áudio. Só gasta quando alguém clica."
          />
          <OpcaoDeTranscricao
            ativa={settings.transcricaoDeAudio === "AUTOMATICA"}
            onClick={() => patch({ transcricaoDeAudio: "AUTOMATICA" })}
            titulo="Transcrever tudo automaticamente"
            descricao="Todo áudio recebido já chega com o texto embaixo. Ninguém precisa parar pra ouvir — e nenhum áudio fica sem ler por estar sem fone."
          />
          <OpcaoDeTranscricao
            ativa={settings.transcricaoDeAudio === "DESLIGADA"}
            onClick={() => patch({ transcricaoDeAudio: "DESLIGADA" })}
            titulo="Não transcrever"
            descricao="Nem o botão aparece. A equipe ouve o áudio, como sempre fez."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="size-4" />
            Agrupar conversas do mesmo cliente
          </CardTitle>
          <CardDescription>
            Quem volta a escrever depois de um assunto encerrado cai na mesma conversa, com o histórico à
            vista — como acontece no WhatsApp de verdade. Desligado, cada assunto vira um atendimento
            separado.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Reabrir a conversa anterior</span>
              <span className="block text-xs text-muted-foreground text-pretty">
                Sem isto, quem atende a segunda mensagem não vê o que foi combinado na primeira.
              </span>
            </span>
            <Switch
              checked={settings.groupByCustomer}
              onCheckedChange={(checked) => patch({ groupByCustomer: checked })}
              aria-label="Agrupar conversas do mesmo cliente"
            />
          </label>

          {settings.groupByCustomer ? (
            <NumberField
              id="group-window"
              label="Agrupar se voltar em até"
              sufixo="horas"
              value={settings.groupWindowHours}
              min={1}
              max={720}
              ajuda="Passado esse tempo, o assunto é outro e a conversa começa limpa. O histórico continua no perfil do cliente."
              onSave={(valor) => patch({ groupWindowHours: valor })}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4" />
            Encerrar assuntos parados
          </CardTitle>
          <CardDescription>
            O WhatsApp cobra pra retomar uma conversa parada há mais de 24 horas: passado esse prazo,
            responder exige um modelo aprovado pela Meta. Encerrar antes disso evita deixar assunto
            pendurado até virar custo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Encerrar sozinho por inatividade</span>
              <span className="block text-xs text-muted-foreground text-pretty">
                Marca como resolvida e deixa uma nota na conversa. Se o cliente escrever de novo, o
                atendimento reabre normalmente. Vem ligado porque é proteção de custo, não só
                organização.
              </span>
            </span>
            <Switch
              checked={settings.autoCloseIdle}
              onCheckedChange={(checked) => patch({ autoCloseIdle: checked })}
              aria-label="Encerrar conversas paradas"
            />
          </label>

          {settings.autoCloseIdle ? (
            <NumberField
              id="auto-close"
              label="Encerrar depois de"
              sufixo="horas sem movimento"
              value={settings.autoCloseHours}
              min={1}
              max={23}
              ajuda="No máximo 23: o objetivo é encerrar antes das 24 horas da janela do WhatsApp."
              onSave={(valor) => patch({ autoCloseHours: valor })}
            />
          ) : null}

          {settings.autoCloseIdle ? (
            <>
              <label className="flex items-center justify-between gap-4 rounded-md border p-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Avisar o cliente ao encerrar</span>
                  <span className="block text-xs text-muted-foreground text-pretty">
                    Sem o aviso a conversa some só do seu lado: o cliente continua achando que tem
                    alguém do outro lado e volta dias depois cobrando. Só é enviado a quem ainda
                    está dentro das 24 horas — fora disso o WhatsApp recusaria a mensagem, e
                    conversa antiga é encerrada em silêncio.
                  </span>
                </span>
                <Switch
                  checked={settings.autoCloseNotify}
                  onCheckedChange={(checked) => patch({ autoCloseNotify: checked })}
                  aria-label="Avisar o cliente ao encerrar por inatividade"
                />
              </label>

              {settings.autoCloseNotify ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="auto-close-message" className="text-xs">
                    Mensagem de despedida
                  </Label>
                  <Textarea
                    id="auto-close-message"
                    rows={3}
                    value={despedida}
                    onChange={(event) => setDespedida(event.target.value)}
                    maxLength={1000}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={
                        salvandoDespedida ||
                        despedida.trim().length < 5 ||
                        despedida.trim() === settings.autoCloseMessage
                      }
                      onClick={async () => {
                        setSalvandoDespedida(true);
                        const atualizada = await patch({
                          autoCloseMessage: despedida.trim(),
                        });
                        if (atualizada) toast.success("Mensagem de despedida salva.");
                        setSalvandoDespedida(false);
                      }}
                    >
                      {salvandoDespedida ? <Spinner /> : null}
                      Salvar mensagem
                    </Button>
                    <span className="text-xs text-muted-foreground">{despedida.length}/1000</span>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
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
  label,
  sufixo,
  value,
  min,
  max,
  ajuda,
  onSave,
}: {
  id: string;
  label: string;
  sufixo: string;
  value: number;
  min: number;
  max: number;
  ajuda: string;
  onSave: (valor: number) => Promise<unknown>;
}) {
  const [rascunho, setRascunho] = useState(String(value));
  const [salvando, setSalvando] = useState(false);

  const numero = Number(rascunho);
  const valido = Number.isInteger(numero) && numero >= min && numero <= max;
  const mudou = valido && numero !== value;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          value={rascunho}
          onChange={(event) => setRascunho(event.target.value)}
          className="h-9 w-24"
        />
        <span className="text-sm text-muted-foreground">{sufixo}</span>
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
      <p className="text-xs text-muted-foreground text-pretty">{ajuda}</p>
      {!valido ? (
        <p className="text-xs text-destructive">
          Informe um número inteiro entre {min} e {max}.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Uma das três escolhas de transcrição.
 *
 * Três linhas empilhadas com a atual acesa, e não um seletor: cada opção
 * carrega uma consequência de custo que precisa estar visível ANTES do
 * clique, e explicação não cabe dentro de um `<option>`.
 */
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
