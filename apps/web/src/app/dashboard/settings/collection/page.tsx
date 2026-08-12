"use client";

import { ClipboardList, GripVertical, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/ui/select-field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/empty-state";
import { PageSkeleton } from "@/components/page-skeleton";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { CollectionField, CollectionFieldTarget, CollectionFieldType } from "@/lib/types";

const TYPE_OPTIONS = [
  { value: "TEXT", label: "Texto" },
  { value: "EMAIL", label: "E-mail" },
  { value: "PHONE", label: "Telefone" },
  { value: "DOCUMENT", label: "CPF / CNPJ" },
  { value: "DATE", label: "Data" },
  { value: "NUMBER", label: "Número" },
];

const TARGET_OPTIONS = [
  { value: "METADATA", label: "Ficha do cliente" },
  { value: "NAME", label: "Nome do contato" },
  { value: "EMAIL", label: "E-mail do contato" },
];

const TARGET_LABEL: Record<CollectionFieldTarget, string> = {
  METADATA: "Ficha",
  NAME: "Nome do contato",
  EMAIL: "E-mail do contato",
};

export default function CollectionFieldsPage() {
  const [fields, setFields] = useState<CollectionField[] | null>(null);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<CollectionFieldType>("TEXT");
  const [target, setTarget] = useState<CollectionFieldTarget>("METADATA");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<CollectionField[]>("/collection-fields")
      .then(setFields)
      .catch(() => toast.error("Não deu pra carregar os campos."));
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const created = await apiFetch<CollectionField>("/collection-fields", {
        method: "POST",
        body: JSON.stringify({ label, description: description || undefined, type, target }),
      });
      setFields((prev) => [...(prev ?? []), created]);
      setLabel("");
      setDescription("");
      setType("TEXT");
      setTarget("METADATA");
      toast.success("Campo criado.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não deu pra criar o campo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(field: CollectionField, patch: Partial<CollectionField>) {
    try {
      const updated = await apiFetch<CollectionField>(`/collection-fields/${field.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setFields((prev) => (prev ?? []).map((item) => (item.id === field.id ? updated : item)));
    } catch {
      toast.error("Não deu pra salvar.");
    }
  }

  async function handleRemove(field: CollectionField) {
    try {
      await apiFetch(`/collection-fields/${field.id}`, { method: "DELETE" });
      setFields((prev) => (prev ?? []).filter((item) => item.id !== field.id));
    } catch {
      toast.error("Não deu pra remover.");
    }
  }

  if (!fields) return <PageSkeleton rows={3} />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="size-4" />
            Dados que a IA precisa coletar
          </CardTitle>
          <CardDescription>
            A IA pede esses dados ao longo da conversa e registra conforme o cliente responde. Com um campo
            marcado como obrigatório, ela <strong>não consegue transferir</strong> o atendimento antes de
            coletá-lo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {fields.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Nenhum campo configurado"
              description="Sem campos, a IA atende normalmente e só guarda o que achar relevante."
            />
          ) : (
            <div className="flex flex-col divide-y">
              {fields.map((field) => (
                <div key={field.id} className="flex items-center gap-3 py-3 first:pt-0">
                  <GripVertical className="size-4 shrink-0 text-muted-foreground/50" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{field.label}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {TYPE_OPTIONS.find((option) => option.value === field.type)?.label}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {TARGET_LABEL[field.target]}
                      </Badge>
                    </div>
                    {field.description ? (
                      <p className="text-xs text-muted-foreground">{field.description}</p>
                    ) : null}
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    Obrigatório
                    <Switch
                      checked={field.required}
                      onCheckedChange={(checked) => handleToggle(field, { required: checked })}
                      aria-label={`Tornar ${field.label} obrigatório`}
                    />
                  </label>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remover ${field.label}`}
                    onClick={() => handleRemove(field)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3 rounded-md border p-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="field-label" className="text-xs">
                Nome do campo
              </Label>
              <Input
                id="field-label"
                className="w-48"
                placeholder="Nome completo"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                required
                minLength={2}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="field-description" className="text-xs">
                Como pedir (opcional)
              </Label>
              <Input
                id="field-description"
                className="w-56"
                placeholder="Nome como está no documento"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <SelectField
              label="Tipo"
              className="w-36"
              value={type}
              options={TYPE_OPTIONS}
              onChange={(next) => setType(next as CollectionFieldType)}
            />
            <SelectField
              label="Salvar em"
              className="w-44"
              value={target}
              options={TARGET_OPTIONS}
              onChange={(next) => setTarget(next as CollectionFieldTarget)}
            />
            <Button type="submit" disabled={saving || label.trim().length < 2}>
              {saving ? <Spinner /> : null}
              Adicionar
            </Button>
          </form>

          <p className="text-xs text-muted-foreground">
            Escolher <strong>Nome do contato</strong> faz a IA corrigir o nome do cliente na lista — útil
            quando o perfil do WhatsApp vem só com o número ou um apelido.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
