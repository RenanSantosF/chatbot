"use client";

import {
  Bell,
  BellRing,
  CalendarClock,
  ChartNoAxesColumn,
  Gauge,
  MessageCircleMore,
  LogOut,
  Settings,
  TriangleAlert,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { CopilotWidget } from "@/components/copilot-widget";
import { Marca } from "@/components/marca";
import { ThemeToggle } from "@/components/theme-toggle";
import { RealtimeProvider, useRealtime } from "@/components/realtime-provider";
import { SessionProvider } from "@/components/session-provider";
import { apiFetch } from "@/lib/api-client";
import { conversationCache } from "@/lib/conversation-cache";
import { inboxListCache } from "@/lib/inbox-list-cache";
import { ApiError } from "@/lib/api-error";
import { avisoDeFimDaLiberacao } from "@/lib/liberacao";
import { cn } from "@/lib/utils";
import type {
  EstadoDaCobranca,
  EstadoDoCanalSessao,
  SessionTenant,
  SessionUser,
  UserRole,
} from "@/lib/types";
import { SITE_NAME } from "@/lib/site";
import { toast } from "sonner";

// `roles` ausente = todo mundo vê. As telas de configuração da empresa
// ficam só com quem administra — o mesmo recorte que os guards da API já
// aplicam, aqui só pra não mostrar porta que vai bater em 403.
const NAV_ITEMS: {
  href: string;
  label: string;
  icon: typeof MessageCircleMore;
  roles?: UserRole[];
}[] = [
  // O Inbox é a raiz do painel: é onde se trabalha o dia inteiro, e é o
  // que abre ao entrar.
  { href: "/dashboard", label: "Conversas", icon: MessageCircleMore },
  { href: "/dashboard/visao-geral", label: "Visão geral", icon: ChartNoAxesColumn },
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

/**
 * O convite pra ligar os avisos — com o nome escrito.
 *
 * Era um sino fantasma de 16px encostado em outros três ícones iguais, e
 * ninguém achava: o recurso mais útil do painel dependia de a pessoa
 * passar o mouse num ícone sem rótulo pra descobrir o que ele fazia. Agora
 * é um botão com palavra, na cor da marca, que se lê de relance.
 *
 * Ele some sozinho depois de resolvido — quem já ativou (ou já recusou)
 * não precisa de um botão permanente ocupando a faixa. O controle que NÃO
 * some mora no perfil, e é lá que dá pra desligar ou entender o bloqueio.
 *
 * A palavra aparece no celular também. Medida antes de decidir: gatilho da
 * lateral, botão inteiro, seletor de tema e sair somam ~300px dos 390 de um
 * telefone comum, então o rótulo cabe — e um ícone mudo no telefone seria
 * repetir ali o defeito que este botão veio consertar.
 */
function NotificationsButton() {
  const { notifPermission, enableNotifications } = useRealtime();

  if (notifPermission !== "default") {
    return null;
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={enableNotifications}
      aria-label="Ativar avisos de mensagem nova"
      title="Ativar avisos de mensagem nova"
      // Branco com borda, e não verde: é um convite, não um alerta — e o
      // verde fica pra marca.
      className="h-8 shrink-0 gap-1.5 border bg-card px-2.5 text-foreground shadow-xs hover:bg-muted"
    >
      <BellRing className="size-4" />
      <span className="text-xs font-medium">Ativar avisos</span>
    </Button>
  );
}

/**
 * Dois momentos da mesma queda: sem conexão ("Reconectando"), e de volta
 * mas ainda buscando o que chegou nesse meio-tempo ("Sincronizando") — o
 * mesmo "Conectando…/Atualizando…" do WhatsApp no celular. O segundo é
 * discreto de propósito: nada está errado, só não está em dia ainda.
 */
function ConnectionBadge() {
  const { connected, sincronizando, historico } = useRealtime();

  if (!connected) {
    return (
      <Badge variant="outline" className="animate-pulse gap-1 text-amber-600">
        <Bell className="size-3" />
        Reconectando
      </Badge>
    );
  }

  /*
   * As conversas do aparelho chegando (primeira conexão por QR code, ou
   * reconexão). Era uma faixa amarela de lado a lado no topo, e ocupava a
   * tela justo no momento em que a pessoa quer ver as conversas
   * aparecendo. Nada está errado — só chegando —, então fala baixo, no
   * mesmo lugar e no mesmo tom do "Sincronizando". O número de mensagens
   * fica no título, pra quem quiser saber.
   */
  if (historico?.importando) {
    const progresso = Math.min(99, Math.round(historico.progresso ?? 0));
    return (
      <span
        role="status"
        title={
          historico.mensagens > 0
            ? `${historico.mensagens.toLocaleString("pt-BR")} mensagens até agora. As conversas vão aparecendo sozinhas.`
            : "As conversas vão aparecendo sozinhas."
        }
        className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground animate-in fade-in"
      >
        <Spinner className="size-3" />
        Trazendo conversas{progresso > 0 ? ` · ${progresso}%` : ""}
      </span>
    );
  }

  if (!sincronizando) return null;

  return (
    <span
      role="status"
      className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground animate-in fade-in"
    >
      <Spinner className="size-3" />
      Sincronizando
    </span>
  );
}

/**
 * O WhatsApp da empresa caiu — e isso é diferente do painel ter caído.
 *
 * A distinção importa porque as consequências são opostas. "Reconectando"
 * ali em cima quer dizer que ESTA aba perdeu contato com o servidor: as
 * mensagens continuam sendo entregues, só não aparecem aqui até voltar.
 * Isto aqui é o contrário — o painel está ótimo, e é o WhatsApp que não
 * está mais ligado. Quem atende continua digitando e apertando enviar, e
 * cada mensagem some no caminho.
 *
 * Por isso ocupa uma faixa, e não uma etiqueta discreta: é o único aviso
 * do produto que significa "pare o que está fazendo".
 */
function CanalCaido() {
  const { canal } = useRealtime();
  if (!canal || canal.estado === "CONECTADO") return null;

  const desvinculado = canal.estado === "DESCONECTADO";

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-xs text-destructive"
    >
      <TriangleAlert className="size-3.5 shrink-0" />
      <span className="font-medium">
        {desvinculado
          ? "O WhatsApp desta empresa está desconectado."
          : "O WhatsApp está aguardando a leitura do QR code."}
      </span>
      <span className="text-destructive/80">
        {canal.lastError ?? "As mensagens enviadas agora não vão chegar."}
      </span>
      <Link href="/dashboard/settings/whatsapp" className="font-medium underline underline-offset-2">
        Reconectar
      </Link>
    </div>
  );
}

/** "2 dias, 4 horas e 12 minutos" — sempre os dois maiores, nunca mais que isso. */
function formatarTempoRestante(ms: number): string {
  if (ms <= 0) return "menos de um minuto";
  const minutosTotais = Math.floor(ms / 60_000);
  const dias = Math.floor(minutosTotais / (60 * 24));
  const horas = Math.floor((minutosTotais % (60 * 24)) / 60);
  const minutos = minutosTotais % 60;

  const partes: string[] = [];
  if (dias > 0) partes.push(`${dias} dia${dias === 1 ? "" : "s"}`);
  if (horas > 0) partes.push(`${horas} hora${horas === 1 ? "" : "s"}`);
  if (dias === 0 && minutos > 0) partes.push(`${minutos} minuto${minutos === 1 ? "" : "s"}`);
  if (partes.length === 0) return "menos de um minuto";
  return partes.slice(0, 2).join(" e ");
}

/**
 * A assinatura venceu, e o acesso vai ser cortado num prazo contado —
 * fica visível em TODA tela, de propósito, porque é o único aviso deste
 * painel que tem um relógio correndo contra a operação da empresa.
 *
 * O prazo em si (`bloqueiaEm`) vem pronto do servidor — o contador aqui só
 * traduz a diferença pro relógio do navegador a cada minuto, nunca decide
 * sozinho quando bloquear (isso é o BillingGuard, no servidor).
 */
function CobrancaVencida({ cobranca, role }: { cobranca: EstadoDaCobranca; role: UserRole }) {
  const [agora, setAgora] = useState(() => Date.now());
  const [indo, setIndo] = useState(false);

  useEffect(() => {
    if (!cobranca.emCarencia) return;
    const timer = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [cobranca.emCarencia]);

  if (!cobranca.emCarencia || !cobranca.bloqueiaEm) return null;

  async function regularizar() {
    setIndo(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/billing/checkout", { method: "POST" });
      window.location.href = url;
    } catch (erro) {
      toast.error(erro instanceof ApiError ? erro.message : "Não deu pra abrir o pagamento.");
      setIndo(false);
    }
  }

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-xs text-destructive"
    >
      <TriangleAlert className="size-3.5 shrink-0" />
      <span className="font-medium">Assinatura vencida.</span>
      <span className="text-destructive/80">
        O acesso será bloqueado em {formatarTempoRestante(cobranca.bloqueiaEm - agora)}.
      </span>
      {role === "OWNER" ? (
        <button
          type="button"
          disabled={indo}
          onClick={() => void regularizar()}
          className="inline-flex items-center gap-1 font-medium underline underline-offset-2 disabled:opacity-60"
        >
          {indo ? <Spinner className="size-3" /> : null}
          Regularizar pagamento
        </button>
      ) : null}
    </div>
  );
}

/**
 * Os dias liberados à mão estão acabando, e não há assinatura pra seguir.
 *
 * Aparece nos três últimos dias (ver avisoDeFimDaLiberacao) — sem ele,
 * quem ganhou dias de teste só descobria que acabou quando já estava
 * bloqueado, que é o pior momento pra pedir um cartão. Âmbar enquanto há
 * folga; vermelho no último dia.
 */
function LiberacaoAcabando({ cobranca, role }: { cobranca: EstadoDaCobranca; role: UserRole }) {
  const [agora, setAgora] = useState(() => Date.now());
  const [indo, setIndo] = useState(false);
  const aviso = avisoDeFimDaLiberacao(cobranca, agora);
  const avisando = aviso !== null;

  useEffect(() => {
    if (!avisando) return;
    const timer = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [avisando]);

  if (!aviso) return null;

  async function assinar() {
    setIndo(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/billing/checkout", { method: "POST" });
      window.location.href = url;
    } catch (erro) {
      toast.error(erro instanceof ApiError ? erro.message : "Não deu pra abrir o pagamento.");
      setIndo(false);
    }
  }

  const dia = new Date(aviso.ate).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b px-4 py-2 text-center text-xs",
        aviso.urgente
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
      )}
    >
      <CalendarClock className="size-3.5 shrink-0" />
      <span className="font-medium">
        Seu acesso liberado termina em {formatarTempoRestante(aviso.restante)} ({dia}).
      </span>
      <span className="opacity-80">
        {role !== "OWNER"
          ? "Peça para o dono da conta assinar e continuar sem interrupção."
          : aviso.cobrancaNoFim
            ? "Assine agora e continue sem interrupção — a primeira cobrança só acontece quando ele acabar."
            : "Assine agora para continuar usando sem interrupção."}
      </span>
      {role === "OWNER" ? (
        <button
          type="button"
          disabled={indo}
          onClick={() => void assinar()}
          className="inline-flex items-center gap-1 font-medium underline underline-offset-2 disabled:opacity-60"
        >
          {indo ? <Spinner className="size-3" /> : null}
          Assinar agora
        </button>
      ) : null}
    </div>
  );
}

function Nav({ role, plataforma }: { role: UserRole; plataforma: boolean }) {
  const pathname = usePathname();
  const { totalUnread } = useRealtime();
  // Configurações abre sozinho quando você já está dentro de alguma seção
  // dela — assim o submenu não some justo quando ele é útil.
  const inSettings =
    pathname.startsWith("/dashboard/settings") || pathname === "/dashboard/settings/knowledge";
  const canConfigure = role === "OWNER" || role === "ADMIN";

  return (
    <SidebarMenu>
      {NAV_ITEMS.map((item) => {
        const showBadge = item.href === "/dashboard" && totalUnread > 0;
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

      {/* Só pro dono da plataforma (ver PLATFORM_ADMIN_EMAILS na API). */}
      {plataforma ? (
        <SidebarMenuItem>
          <SidebarMenuButton
            render={<Link href="/dashboard/plataforma" />}
            isActive={pathname.startsWith("/dashboard/plataforma")}
            tooltip="Plataforma"
          >
            <Gauge />
            <span>Plataforma</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
    </SidebarMenu>
  );
}

function Shell({
  user,
  tenant,
  cobranca,
  plataforma,
  children,
}: {
  user: SessionUser;
  tenant: SessionTenant;
  cobranca: EstadoDaCobranca;
  plataforma: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isInbox = pathname === "/dashboard";
  // Área (dois primeiros segmentos), não rota inteira: assim a animação de
  // entrada roda ao trocar de seção, e não a cada sub-tela de Configurações.
  const secao = pathname.split("/").slice(0, 3).join("/");

  async function handleLogout() {
    await apiFetch("/auth/logout", { method: "POST" });
    // A troca pra `/login` é navegação de SPA — não recarrega o processo,
    // então o que ficou em memória (o cache de conversas) sobreviveria
    // sozinho até a próxima pessoa logar nesta mesma aba.
    conversationCache.clear();
    inboxListCache.clear();
    router.push("/login");
    router.refresh();
  }

  return (
    <SidebarProvider defaultOpen={false} open={false} onOpenChange={() => {}}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div
            className="flex items-center justify-center py-1.5"
            title={`${tenant.name} · ${SITE_NAME}`}
          >
            <Marca className="size-6 shrink-0" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <Nav role={user.role} plataforma={plataforma} />
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
        {/* Faixa de 44px, e não os 64px de antes.
            
            Ela não tem conteúdo próprio — só os controles de tema, aviso e
            saída, encostados à direita. Vinte pixels de altura à toa em
            cima do Inbox são vinte pixels a menos de conversa, na tela onde
            a pessoa passa o dia. Os botões encolheram junto pra a faixa não
            ficar apertada.

            Fundo sólido e mais fundo que o `card` dos painéis: no tema
            escuro os dois quase se encostavam e a barra parecia parte da
            lista de conversas. A borda em 8% de branco (ver globals.css)
            fecha a separação. */}
        <header className="sticky top-0 z-20 flex h-11 shrink-0 items-center gap-1 border-b bg-background px-3">
          {/* O único jeito de chegar na navegação pelo celular.

              A barra lateral já virava uma gaveta em telas estreitas — o
              componente faz isso sozinho —, mas nada no painel a abria.
              Quem entrasse pelo telefone ficava preso na tela em que caiu,
              sem Inbox, sem Clientes e sem Configurações. */}
          <SidebarTrigger className="md:hidden" />
          <div className="flex-1" />
          <ConnectionBadge />
          <NotificationsButton />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleLogout}
            aria-label="Sair da conta"
            title="Sair"
          >
            <LogOut className="size-4" />
          </Button>
        </header>
        <CobrancaVencida cobranca={cobranca} role={user.role} />
        <LiberacaoAcabando cobranca={cobranca} role={user.role} />
        <CanalCaido />
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
  canal: EstadoDoCanalSessao;
  cobranca: EstadoDaCobranca;
  plataforma: boolean;
  children: React.ReactNode;
}) {
  return (
    <SessionProvider user={props.user} tenant={props.tenant}>
      {/* O estado do WhatsApp entra já conhecido, e não em branco à espera
          de um evento que pode nunca chegar — quem abre o painel com a
          sessão caída não recebeu evento nenhum, ele passou antes de a
          página existir. */}
      <RealtimeProvider canalInicial={props.canal}>
        <Shell {...props} />
      </RealtimeProvider>
    </SessionProvider>
  );
}
