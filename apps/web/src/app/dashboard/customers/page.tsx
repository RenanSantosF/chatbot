"use client";

import { MessageSquarePlus, Search, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StartConversationDialog } from "@/components/customers/start-conversation-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerDetailSheet } from "@/components/customers/customer-detail-sheet";
import { EmptyState } from "@/components/empty-state";
import { ImportContactsDialog } from "@/components/customers/import-contacts-dialog";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-client";
import type { Customer } from "@/lib/types";

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);

  /**
   * A busca acontece no SERVIDOR.
   *
   * Era no navegador, sobre a lista inteira baixada de uma vez. Isso
   * funcionava enquanto os clientes vinham um a um, pelas conversas — e
   * parou de funcionar quando a agenda do aparelho passou a ser
   * importada: são milhares de contatos, e quem estivesse fora da
   * primeira leva simplesmente não existia pra quem procurava.
   */
  const load = useCallback((termo = "") => {
    const busca = termo.trim();
    return apiFetch<Customer[]>(
      busca ? `/customers?search=${encodeURIComponent(busca)}` : "/customers",
    )
      .then(setCustomers)
      .catch(() => toast.error("Não deu pra carregar os clientes."))
      .finally(() => setLoading(false));
  }, []);

  // Espera a digitação parar: sem isso, "richard" dispara sete consultas
  // e a resposta da quarta pode chegar depois da sétima.
  useEffect(() => {
    const timer = setTimeout(() => void load(query), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  // O e-mail continua sendo filtrado aqui: ele não entra na busca do
  // servidor (quase nenhum cliente do WhatsApp tem e-mail) e refinar o
  // que já veio é de graça.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(q) ||
        customer.phone.includes(q) ||
        (customer.email?.toLowerCase().includes(q) ?? false),
    );
  }, [customers, query]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clientes"
        description="Cadastro e histórico dos clientes finais."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Pra um número que ainda NÃO é cliente. O botão de mensagem
                do contato resolve quem já está na lista; este resolve
                quem a empresa acabou de anotar num papel. */}
            <StartConversationDialog
              onStarted={(id) => router.push(`/dashboard/inbox?c=${id}`)}
              gatilho={
                <Button size="sm" variant="outline">
                  <MessageSquarePlus className="size-4" />
                  Nova conversa
                </Button>
              }
            />
            <ImportContactsDialog onImported={() => void load(query)} />
          </div>
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nome, telefone ou e-mail..."
          className="pl-8"
        />
      </div>

      {loading ? (
        <div className="flex flex-col divide-y rounded-lg border">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 p-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={customers.length === 0 ? "Nenhum cliente ainda" : "Nenhum cliente encontrado"}
          description={
            customers.length === 0
              ? "Assim que alguém mandar mensagem, o cadastro aparece aqui automaticamente."
              : "Tente outro nome, telefone ou e-mail."
          }
        />
      ) : (
        <div className="flex flex-col divide-y overflow-hidden rounded-lg border">
          {filtered.map((customer) => (
            <button
              key={customer.id}
              type="button"
              onClick={() => setSelected(customer)}
              className="flex items-center gap-3 p-3 text-left transition-colors hover:bg-muted/60"
            >
              <Avatar className="size-9 shrink-0">
                <AvatarFallback className="text-xs">{initials(customer.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{customer.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {customer.phone}
                  {customer.email ? ` · ${customer.email}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(customer.createdAt).toLocaleDateString("pt-BR")}
              </span>
            </button>
          ))}
        </div>
      )}

      <CustomerDetailSheet
        customer={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}
