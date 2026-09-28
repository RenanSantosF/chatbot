"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { Queue } from "@/lib/types";

export function CreateQueueCard({ onCreated }: { onCreated: (queue: Queue) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const queue = await apiFetch<Queue>("/queues", {
        method: "POST",
        body: JSON.stringify({ name, description: description || undefined }),
      });
      onCreated(queue);
      setName("");
      setDescription("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não deu pra criar o setor.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Novo setor</CardTitle>
        <CardDescription>Um departamento ou área pra onde a IA pode transferir atendimentos.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="queue-name" className="text-xs text-muted-foreground">
                Nome
              </Label>
              <Input
                id="queue-name"
                placeholder="Ex: Jurídico"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="queue-description" className="text-xs text-muted-foreground">
                Descrição (opcional)
              </Label>
              <Input
                id="queue-description"
                placeholder="Ex: Análises jurídicas e contratos"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Button type="submit" disabled={creating || !name.trim()}>
              Criar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
