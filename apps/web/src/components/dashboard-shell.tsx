"use client";

import {
  Bell,
  BellRing,
  ChartNoAxesColumn,
  MessageCircleMore,
  LogOut,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { CopilotWidget } from "@/components/copilot-widget";
import { ThemeToggle } from "@/components/theme-toggle";
import { RealtimeProvider, useRealtime } from "@/components/realtime-provider";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SessionTenant, SessionUser, UserRole } from "@/lib/types";

// `roles` ausente = todo mundo vê. As telas de configuração da empresa
// ficam só com quem administra — o mesmo recorte que os guards da API já
// aplicam, aqui só pra não mostrar porta que vai bater em 403.
const NAV_ITEMS: {
  href: string;
  label: string;
  icon: typeof MessageCircleMore;
  roles?: UserRole[];
}[] = [
  { href: "/dashboard", label: "Visão geral", icon: ChartNoAxesColumn },
  { href: "/dashboard/inbox", label: "Inbox", icon: MessageCircleMore },
  { href: "/dashboard/customers", label: "Clientes", icon: Users },
];

const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: "Dono",
  ADMIN: "Admin",
  AGENT: "Atendente",
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function NotificationsButton() {
  const { notifPermission, enableNotifications } = useRealtime();

  if (notifPermission !== "default") {
    return null;
  }

  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={enableNotifications}
      aria-label="Ativar avisos de mensagem nova"
      title="Ativar avisos de mensagem nova"
    >
      <BellRing className="size-5" />
    </Button>
  );
}

function ConnectionBadge() {
  const { connected } = useRealtime();
  if (connected) return null;

  return (
    <Badge variant="outline" className="animate-pulse gap-1 text-amber-600">
      <Bell className="size-3" />
      Reconectando
    </Badge>
  );
}

function Nav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const { totalUnread } = useRealtime();
  // Configurações abre sozinho quando você já está dentro de alguma seção
  // dela — assim o submenu não some justo quando ele é útil.
  const inSettings =
    pathname.startsWith("/dashboard/settings") || pathname === "/dashboard/knowledge";
  const canConfigure = role === "OWNER" || role === "ADMIN";

  return (
    <SidebarMenu>
      {NAV_ITEMS.map((item) => {
        const showBadge = item.href === "/dashboard/inbox" && totalUnread > 0;
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              render={<Link href={item.href} />}
              isActive={pathname === item.href}
              tooltip={item.label}
            >
              <item.icon />
              <span>{item.label}</span>
              {showBadge ? (
                <span className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground group-data-[collapsible=icon]:hidden">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              ) : null}
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}

      {canConfigure ? (
        <SidebarMenuItem>
          <SidebarMenuButton
            render={<Link href="/dashboard/settings/whatsapp" />}
            isActive={inSettings}
            tooltip="Configurações"
          >
            <Settings />
            <span>Configurações</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
    </SidebarMenu>
  );
}

function Shell({
  user,
  tenant,
  children,
}: {
  user: SessionUser;
  tenant: SessionTenant;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isInbox = pathname === "/dashboard/inbox";
  // Área (dois primeiros segmentos), não rota inteira: assim a animação de
  // entrada roda ao trocar de seção, e não a cada sub-tela de Configurações.
  const secao = pathname.split("/").slice(0, 3).join("/");

  async function handleLogout() {
    await apiFetch("/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <SidebarProvider defaultOpen={false} open={false} onOpenChange={() => {}}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div
            className="flex items-center justify-center py-1.5"
            title={`${tenant.name} · Clara`}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
              C
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <Nav role={user.role} />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href="/dashboard/profile" />}
                isActive={pathname === "/dashboard/profile"}
                tooltip="Meu perfil"
                size="lg"
              >
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">{initials(user.name)}</AvatarFallback>
                </Avatar>
                {/* O menu vive recolhido; sem esconder o texto aqui, o nome
                    e o papel vazavam por baixo do avatar. */}
                <div className="flex min-w-0 flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-sm font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/80 px-4 backdrop-blur-sm">
          <div />
          <div className="flex items-center gap-2">
            <ConnectionBadge />
            <NotificationsButton />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              aria-label="Sair da conta"
              title="Sair"
            >
              <LogOut className="size-5" />
            </Button>
          </div>
        </header>
        {user.mustChangePassword && pathname !== "/dashboard/profile" ? (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm">
            <span className="text-amber-800 dark:text-amber-300">
              Você entrou com uma senha temporária.{" "}
              <Link href="/dashboard/profile" className="font-medium underline underline-offset-4">
                Defina sua própria senha
              </Link>{" "}
              pra ninguém mais conhecer seu acesso.
            </span>
          </div>
        ) : null}
        {/* O Inbox é a tela principal e ocupa tudo, colado nas bordas, como
            no WhatsApp Web: sem respiro em volta, sem título por cima e sem
            rolagem da página — quem rola são as colunas de dentro. As
            demais telas são de leitura/formulário e ficam melhor com margem
            e medida de linha limitada. */}
        {/* <div>, não <main>: o SidebarInset já renderiza um <main>, e
            aninhar dois é HTML inválido — além de ter me feito medir o
            elemento errado ao investigar a rolagem. */}
        <div
          className={cn(
            // min-h-0 também aqui: sem ele o <main> cresce até o tamanho
            // do conteúdo e o overflow-y-auto nunca entra em ação — a
            // parte de baixo da tela fica cortada e inalcançável.
            "flex min-h-0 flex-1 flex-col",
            isInbox ? "overflow-hidden" : "overflow-y-auto p-4 sm:p-6",
          )}
        >
          <div
            key={secao}
            className={cn(
              "flex w-full flex-1 flex-col",
              isInbox ? "min-h-0" : "mx-auto max-w-6xl gap-6",
              "duration-300 ease-out animate-in fade-in slide-in-from-bottom-2",
            )}
          >
            {children}
          </div>
        </div>
        <CopilotWidget />
      </SidebarInset>
    </SidebarProvider>
  );
}

export function DashboardShell(props: {
  user: SessionUser;
  tenant: SessionTenant;
  children: React.ReactNode;
}) {
  return (
    <RealtimeProvider>
      <Shell {...props} />
    </RealtimeProvider>
  );
}
