"use client";

import {
  Bell,
  BellRing,
  Bot,
  Building2,
  ChartNoAxesColumn,
  Inbox,
  LibraryBig,
  LogOut,
  ListTree,
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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
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
  icon: typeof Inbox;
  roles?: UserRole[];
}[] = [
  { href: "/dashboard", label: "Visão geral", icon: ChartNoAxesColumn },
  { href: "/dashboard/inbox", label: "Inbox", icon: Inbox },
  { href: "/dashboard/customers", label: "Clientes", icon: Users },
  { href: "/dashboard/ai", label: "IA", icon: Bot, roles: ["OWNER", "ADMIN"] },
  { href: "/dashboard/knowledge", label: "Conhecimento", icon: LibraryBig, roles: ["OWNER", "ADMIN"] },
  { href: "/dashboard/team", label: "Equipe", icon: Building2, roles: ["OWNER", "ADMIN"] },
  { href: "/dashboard/queues", label: "Filas", icon: ListTree, roles: ["OWNER", "ADMIN"] },
  { href: "/dashboard/settings", label: "Configurações", icon: Settings, roles: ["OWNER", "ADMIN"] },
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
    <Button size="sm" variant="ghost" onClick={enableNotifications} title="Receber aviso de mensagem nova">
      <BellRing className="size-4" />
      <span className="hidden sm:inline">Ativar avisos</span>
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

  const visible = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));

  return (
    <SidebarMenu>
      {visible.map((item) => {
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

  async function handleLogout() {
    await apiFetch("/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
              C
            </div>
            <div className="flex flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-medium">{tenant.name}</span>
              <span className="truncate text-xs text-muted-foreground">Clara</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Atendimento</SidebarGroupLabel>
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
                <div className="flex min-w-0 flex-col overflow-hidden">
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
          <SidebarTrigger />
          <div className="flex items-center gap-2">
            <ConnectionBadge />
            <NotificationsButton />
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sair</span>
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
        <main className="flex flex-1 flex-col overflow-y-auto p-4 sm:p-6">
          <div
            key={pathname}
            className={cn(
              "mx-auto flex w-full flex-1 flex-col gap-6",
              // O Inbox é um painel de três colunas e precisa de toda a
              // largura; as telas de leitura/formulário ficam melhor com
              // uma medida de linha limitada.
              pathname === "/dashboard/inbox" ? "max-w-none" : "max-w-6xl",
              "duration-300 ease-out animate-in fade-in slide-in-from-bottom-2",
            )}
          >
            {children}
          </div>
        </main>
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
