"use client";

import { Route, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/priority";
import { cn } from "@/lib/utils";
import type { ConversationPriority, Queue, RoutingRule, TeamMember } from "@/lib/types";

export function RoutingRulesCard({
  rules,
  team,
  queues,
  onChange,
}: {
  rules: RoutingRule[];
  team: TeamMember[];
  queues: Queue[];
  onChange: (rules: RoutingRule[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [minPriority, setMinPriority] = useState<ConversationPriority>("NORMAL");
  const [target, setTarget] = useState<string>("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setName("");
    setSubject("");
    setMinPriority("NORMAL");
    setTarget("");
    setOpen(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!target) {
      toast.error("Escolha pra quem essa regra manda a conversa.");
      return;
    }
    setSaving(true);
    // O select junta pessoas e filas num campo só; o prefixo diz qual é qual.
    const [kind, id] = target.split(":");
    try {
      const created = await apiFetch<RoutingRule>("/routing-rules", {
        method: "POST",
        body: JSON.stringify({
          name,
          subject,
          minPriority,
          ...(kind === "user" ? { targetUserId: id } : { targetQueueId: id }),
        }),
      });
      onChange([...rules, created]);
      reset();
      toast.success("Regra criada.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não deu pra criar a regra.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(rule: RoutingRule) {
    try {
      await apiFetch(`/routing-rules/${rule.id}`, { method: "DELETE" });
      onChange(rules.filter((item) => item.id !== rule.id));
    } catch {
      toast.error("Não deu pra remover a regra.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Route className="size-4" />
          Quem atende o quê
        </CardTitle>
        <CardDescription>
          Diga o assunto em português e escolha o destino. Quando a IA transferir um atendimento, ela usa
          essas regras pra mandar direto pra pessoa (ou fila) certa.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rules.length === 0 ? (
          <EmptyState
            icon={Route}
            title="Nenhuma regra ainda"
            description="Sem regras, a IA só consegue escolher entre as filas existentes."
          />
        ) : (
          <div className="flex flex-col divide-y">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-start justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{rule.name}</span>
                    {rule.minPriority !== "NORMAL" && rule.minPriority !== "LOW" ? (
                      <span
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[10px] font-medium",
                          PRIORITY_META[rule.minPriority].chip,
                        )}
                      >
                        {PRIORITY_META[rule.minPriority].label} ou mais
                      </span>
                    ) : null}
                    <Badge variant="secondary" className="text-[10px]">
                      {rule.targetUser ? rule.targetUser.name : (rule.targetQueue?.name ?? "sem destino")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground text-pretty">{rule.subject}</p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remover regra ${rule.name}`}
                  onClick={() => handleRemove(rule)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {open ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="rule-name" className="text-xs">
                  Nome da regra
                </Label>
                <Input
                  id="rule-name"
                  className="w-52"
                  placeholder="Cobrança"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  minLength={2}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="rule-target" className="text-xs">
                  Direcionar para
                </Label>
                <select
                  id="rule-target"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  className="h-9 w-60 rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                  required
                >
                  <option value="">Escolha...</option>
                  <optgroup label="Pessoas">
                    {team.map((member) => (
                      <option key={member.id} value={`user:${member.id}`}>
                        {member.name}
                      </option>
                    ))}
                  </optgroup>
                  {queues.length > 0 ? (
                    <optgroup label="Filas (rodízio)">
                      {queues.map((queue) => (
                        <option key={queue.id} value={`queue:${queue.id}`}>
                          {queue.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-subject" className="text-xs">
                Quando usar esta regra
              </Label>
              <Textarea
                id="rule-subject"
                rows={2}
                placeholder="Boleto, segunda via, atraso de pagamento, renegociação de dívida."
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                required
                minLength={3}
              />
              <p className="text-xs text-muted-foreground">
                Esse texto é lido pela IA na hora de escolher. Quanto mais concreto, melhor a escolha.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-xs">Só valer a partir da prioridade</Label>
              <div className="flex flex-wrap gap-1">
                {[...PRIORITY_ORDER].reverse().map((priority) => (
                  <button
                    key={priority}
                    type="button"
                    onClick={() => setMinPriority(priority)}
                    aria-pressed={minPriority === priority}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                      minPriority === priority
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {PRIORITY_META[priority].label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Use <strong>Urgente</strong> pra montar plantão: a regra só entra quando a IA classificar o
                caso como urgente. Com <strong>Baixa</strong> ou <strong>Normal</strong>, vale sempre.
              </p>
            </div>

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={saving || !name.trim() || !subject.trim()}>
                {saving ? <Spinner /> : null}
                Criar regra
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={reset}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <div className="w-fit">
            <Button size="sm" onClick={() => setOpen(true)}>
              Nova regra
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
