"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { AiInstruction } from "@/lib/types";

export function InstructionsManager({
  instructions,
  onChange,
}: {
  instructions: AiInstruction[];
  onChange: (instructions: AiInstruction[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setCreating(true);
    try {
      const created = await apiFetch<AiInstruction>("/ai/instructions", {
        method: "POST",
        body: JSON.stringify({ title, content }),
      });
      onChange([created, ...instructions]);
      setTitle("");
      setContent("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não deu pra criar a instrução.");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(instruction: AiInstruction) {
    try {
      const updated = await apiFetch<AiInstruction>(`/ai/instructions/${instruction.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !instruction.active }),
      });
      onChange(instructions.map((item) => (item.id === updated.id ? updated : item)));
    } catch {
      toast.error("Não deu pra atualizar a instrução.");
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiFetch(`/ai/instructions/${id}`, { method: "DELETE" });
      onChange(instructions.filter((item) => item.id !== id));
    } catch {
      toast.error("Não deu pra remover a instrução.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ensine sua IA</CardTitle>
        <CardDescription>
          Escreva como explicaria pra um funcionário novo. Cada instrução entra no que a IA sabe sobre a empresa.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="instr-title" className="text-xs">
              Título
            </Label>
            <Input
              id="instr-title"
              placeholder="Ex: Valor da consulta"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="instr-content" className="text-xs">
              O que a IA deve saber / fazer
            </Label>
            <Textarea
              id="instr-content"
              rows={2}
              placeholder="Ex: quando perguntarem o valor da consulta, informe que custa R$300 e pode ser presencial ou online."
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          <div>
            <Button type="submit" size="sm" disabled={creating || !title.trim() || !content.trim()}>
              Salvar regra
            </Button>
          </div>
        </form>

        <div className="flex flex-col divide-y">
          {instructions.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma instrução ainda.</p>
          ) : (
            instructions.map((instruction) => (
              <div key={instruction.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{instruction.title}</p>
                  <p className="text-sm text-muted-foreground">{instruction.content}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!instruction.active ? <Badge variant="outline">Inativa</Badge> : null}
                  <Switch checked={instruction.active} onCheckedChange={() => handleToggle(instruction)} />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(instruction.id)}
                    className="text-muted-foreground"
                  >
                    Remover
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
