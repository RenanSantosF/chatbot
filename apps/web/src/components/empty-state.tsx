import type { LucideIcon } from "lucide-react";

/**
 * Estado vazio padrão: ícone em um círculo suave, título e uma linha de
 * explicação — em vez do parágrafo cinza solto que as telas usavam antes.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center duration-300 animate-in fade-in">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="mx-auto max-w-xs text-sm text-muted-foreground text-pretty">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
