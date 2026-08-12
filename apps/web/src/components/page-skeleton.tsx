import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto genérico usado pelos loading.tsx das rotas do painel. O Next
 * mostra isso automaticamente enquanto o server component da página resolve,
 * o que tira a sensação de clique morto ao trocar de tela.
 */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-6 duration-200 animate-in fade-in">
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
