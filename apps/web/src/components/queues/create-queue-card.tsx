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
      toast.error(err instanceof ApiError ? err.message : "Não deu pra criar a fila.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nova fila</CardTitle>
        <CardDescription>Um departamento ou área pra onde a IA pode transferir atendimentos.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="queue-name" className="text-xs">
              Nome
            </Label>
            <Input
              id="queue-name"
              className="w-52"
              placeholder="Ex: Jurídico"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="queue-description" className="text-xs">
              Descrição (opcional)
            </Label>
            <Input
              id="queue-description"
              className="w-72"
              placeholder="Ex: Análises jurídicas e contratos"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={creating || !name.trim()}>
            Criar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
