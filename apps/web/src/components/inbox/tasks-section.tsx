"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import type { Task } from "@/lib/types";

export function TasksSection({ conversationId }: { conversationId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // O componente é remontado (key={conversation.id} no pai) a cada troca
    // de conversa, então `loading` já nasce true — não precisa resetar aqui.
    let cancelled = false;
    apiFetch<Task[]>(`/tasks?conversationId=${conversationId}`)
      .then((result) => {
        if (!cancelled) setTasks(result);
      })
      .catch(() => {
        if (!cancelled) toast.error("Não deu pra carregar as tarefas.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function handleComplete(id: string) {
    try {
      await apiFetch<Task>(`/tasks/${id}/complete`, { method: "PATCH" });
      setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, status: "DONE" } : task)));
    } catch {
      toast.error("Não deu pra concluir a tarefa.");
    }
  }

  if (loading) {
    return null;
  }

  if (tasks.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Tarefas</h3>
      <div className="flex flex-col gap-2">
        {tasks.map((task) => (
          <div key={task.id} className="rounded-md border p-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <span className={task.status === "DONE" ? "text-muted-foreground line-through" : ""}>
                {task.title}
              </span>
              {task.createdByAi ? (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  IA
                </Badge>
              ) : null}
            </div>
            {task.description ? <p className="mt-1 text-xs text-muted-foreground">{task.description}</p> : null}
            {task.status === "OPEN" ? (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 h-6 px-2 text-xs"
                onClick={() => handleComplete(task.id)}
              >
                Concluir
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
