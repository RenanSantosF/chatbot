"use client";

import { MessageSquareDashed, Timer, UserRound } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { AvatarDoCliente } from "@/components/avatar-do-cliente";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { PRIORITY_META } from "@/lib/priority";
import { descreverEspera, type Relogio } from "@/lib/espera";
import { resumoDaMensagem } from "@/lib/mensagem";
import { cn } from "@/lib/utils";
import { TagChip } from "./tag-picker";
import type { ConversationStatus, ConversationSummary } from "@/lib/types";

/**
 * A situação, quando ela diz algo que a linha ainda não disse.
 *
 * "Aberta" e "Aguardando atendente" ficaram de fora, e não por descuido:
 * as duas querem dizer "precisa de alguém daqui", que é o estado NORMAL de
 * quase toda conversa da caixa — e a aba escolhida já diz isso. Escritas
 * em toda linha, viravam uma legenda repetida oito vezes na tela que não
 * ajudava a escolher qual abrir.
 *
 * O que sobrou é o que surpreende: a bola está com o cliente, ou o
 * atendimento já acabou.
 */
const STATUS_LABEL: Partial<Record<ConversationStatus, string>> = {
  WAITING_CUSTOMER: "Aguard. cliente",
  RESOLVED: "Resolvida",
  CLOSED: "Fechada",
};

/** Relativo e curto, como numa lista de conversas de mensageiro. */
function timeLabel(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);

  if (diffDays === 0) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return date.toLocaleDateString("pt-BR", { weekday: "short" });
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}


/**
 * Uma linha da lista, memorizada.
 *
 * A lista é redesenhada a cada evento do tempo real — mensagem, tique de
 * entrega, troca de responsável — de QUALQUER conversa. Sem memorizar,
 * cada evento redesenhava todas as linhas carregadas; memorizada, só a
 * linha que mudou (as outras chegam com as mesmas props).
 */
const LinhaDaConversa = memo(function LinhaDaConversa({
  conversation,
  unread,
  selected,
  saindo,
  animavel,
  relogio,
  onSelect,
  onPreCarregar,
}: {
  conversation: ConversationSummary;
  unread: number;
  selected: boolean;
  saindo: boolean;
  /** Entre as primeiras da lista, onde a reordenação é animada. */
  animavel: boolean;
  relogio: Relogio;
  /** Muda a cada minuto, pra o selo de espera ("há 12 min") andar. */
  minuto: number;
  onSelect: (id: string) => void;
  onPreCarregar?: (id: string) => void;
}) {
  // Uma espera curta antes de pré-carregar: passar o mouse de cima a
  // baixo pela lista não pode virar uma busca por conversa atravessada.
  const esperaDoPonteiro = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (esperaDoPonteiro.current) clearTimeout(esperaDoPonteiro.current);
    },
    [],
  );

  const priority = PRIORITY_META[conversation.priority];
  const showPriority = conversation.priority === "URGENT" || conversation.priority === "HIGH";
  const last = conversation.lastMessage;
  // Apagada não mostra o texto nem fica em branco: a prévia diz o
  // que aconteceu. O conteúdo já nem chega da API (ver
  // `previaVisivel`), então sem este ramo a linha viraria só "Você: ".
  const preview = !last
    ? "Sem mensagens ainda"
    : last.deletedAt
      ? "Mensagem apagada"
      : `${last.senderType === "CUSTOMER" ? "" : "Você: "}${resumoDaMensagem(
          last.content,
          last.messageType,
        )}`;
  const espera = descreverEspera(conversation.waitingSince, relogio);
  // A terceira linha só nasce quando tem o que dizer. Conversa
  // aberta, sem dono e sem etiqueta é o caso comum, e nele a linha
  // não existe — a altura da conversa não muda.
  const rotuloDaSituacao = STATUS_LABEL[conversation.status];
  const temRodape =
    Boolean(rotuloDaSituacao) ||
    Boolean(conversation.assignedUser) ||
    (conversation.tags ?? []).length > 0;

  return (
    <button
      type="button"
      data-conversa-id={conversation.id}
      onClick={() => onSelect(conversation.id)}
      onPointerEnter={() => {
        if (!onPreCarregar) return;
        if (esperaDoPonteiro.current) clearTimeout(esperaDoPonteiro.current);
        esperaDoPonteiro.current = setTimeout(() => onPreCarregar(conversation.id), 90);
      }}
      onPointerLeave={() => {
        if (esperaDoPonteiro.current) clearTimeout(esperaDoPonteiro.current);
      }}
      // Sem barra colorida na lateral e sem fundo tingido: a conversa
      // selecionada muda de superfície, e só. Quem chama atenção na
      // linha é o contador de não lidas, como em qualquer mensageiro.
      // Sem divisória nenhuma entre as conversas: o espaçamento já
      // separa. O que responde ao mouse é a superfície inteira, com
      // canto arredondado — o mesmo gesto do WhatsApp.
      className={cn(
        "mx-1.5 flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-150",
        selected ? "bg-accent" : "hover:bg-accent/60",
        // Resolvida: desliza pro lado e fecha o espaço (globals.css).
        saindo && "conversa-saindo",
        // Fora da tela, a linha não é desenhada nem medida — só guarda
        // o lugar. Com centenas de conversas carregadas ao fim do dia,
        // é o que mantém cada mensagem nova barata de mostrar.
        "[contain-intrinsic-size:auto_72px] [content-visibility:auto]",
      )}
      // A ordem muda quando chega mensagem. Sem animação a lista
      // "pisca" e a pessoa perde de vista onde estava.
      style={
        // A transição de ordem e a saída são dois movimentos no mesmo
        // elemento; deixar as duas ligadas fazia a linha saltar pro
        // lugar novo no meio do deslize.
        //
        // Só as primeiras linhas levam nome de transição: é ali que a
        // conversa que recebeu mensagem aparece subindo. Cada nome é
        // uma foto tirada a cada reordenação, e fotografar a lista
        // inteira era o que pesava com muitas conversas.
        saindo || !animavel
          ? undefined
          : { viewTransitionName: `conversa-${conversation.id}` }
      }
    >
      <AvatarDoCliente
        cliente={conversation.customer}
        className="size-11 shrink-0"
        tamanho={44}
        textoClassName="text-xs"
      />
      <div className="min-w-0 flex-1">
        {/* Linha 1: quem é, e quando falou. Nada mais.

            Ela dividia espaço com o contador de não lidas e o selo
            de espera, e o nome era o primeiro a ser cortado — numa
            lista de clientes, cortar justamente o nome é o pior
            lugar pra economizar. */}
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-[16px]",
              unread > 0 ? "font-semibold" : "font-medium",
            )}
          >
            {conversation.customer.name}
          </span>
          <span
            className={cn(
              "shrink-0 text-[12px] tabular-nums",
              unread > 0 ? "font-medium text-primary" : "text-muted-foreground",
            )}
            // A hora é do relógio de quem olha: o servidor desenha no fuso
            // dele. Ver instrumentation.ts.
            suppressHydrationWarning
          >
            {timeLabel(conversation.lastMessageAt)}
          </span>
        </div>

        {/* Linha 2: o que foi dito, e o que exige ação. */}
        <div className="mt-0.5 flex items-center gap-1.5">
          <p
            className={cn(
              "min-w-0 flex-1 truncate text-[14px]",
              unread > 0 ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {preview}
          </p>
          {showPriority ? (
            <span
              title={`Prioridade ${priority.label.toLowerCase()}`}
              className={cn("size-2 shrink-0 rounded-full", priority.dot)}
              aria-label={`Prioridade ${priority.label.toLowerCase()}`}
            />
          ) : null}
          {espera ? (
            <span
              title={
                espera.foraDoExpediente
                  ? `Sem resposta há ${espera.rotulo} — fora do horário de atendimento`
                  : `Sem resposta há ${espera.rotulo}`
              }
              className={cn(
                "flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                espera.nivel === "grave"
                  ? "bg-destructive/15 text-destructive"
                  : espera.nivel === "atencao"
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    : "bg-muted text-muted-foreground",
              )}
            >
              <Timer className="size-3" />
              {espera.rotulo}
            </span>
          ) : null}
          {unread > 0 ? (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </div>

        {/* Linha 3: só existe quando tem o que dizer.

            Situação, responsável e etiqueta viviam espremidos na
            linha da prévia, cada um numa pastilha com borda, comendo
            o texto da mensagem — que é o que faz a lista parecer um
            mensageiro. Aqui embaixo eles cabem inteiros e sem
            moldura, e a conversa comum (aberta, sem dono, sem
            etiqueta) volta a ter duas linhas só. */}
        {temRodape ? (
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {rotuloDaSituacao ? (
              <span className="shrink-0">{rotuloDaSituacao}</span>
            ) : null}
            {conversation.assignedUser ? (
              // O "?" fica: a lista dizia "Lucas" do mesmo jeito com
              // e sem aceite, e quem batia o olho concluía que a
              // conversa já tinha dono — quando ainda estava parada
              // esperando um clique dele.
              <span
                title={
                  conversation.assignmentAccepted
                    ? `Responsável: ${conversation.assignedUser.name}`
                    : `Indicado para ${conversation.assignedUser.name} — aguardando aceite`
                }
                className={cn(
                  "flex shrink-0 items-center gap-1",
                  !conversation.assignmentAccepted && "text-amber-600 dark:text-amber-400",
                )}
              >
                <UserRound className="size-3" />
                {conversation.assignedUser.name.split(" ")[0]}
                {conversation.assignmentAccepted ? "" : "?"}
              </span>
            ) : null}
            {/* Só a primeira etiqueta. As demais aparecem ao abrir a
                conversa. */}
            {(conversation.tags ?? []).slice(0, 1).map((tag) => (
              <TagChip key={tag.id} tag={tag} className="shrink-0" />
            ))}
          </div>
        ) : null}
      </div>
    </button>
  );
});

/** Um número que muda a cada minuto. */
function useMinuto() {
  const [minuto, setMinuto] = useState(0);
  useEffect(() => {
    const intervalo = setInterval(() => setMinuto((m) => m + 1), 60_000);
    return () => clearInterval(intervalo);
  }, []);
  return minuto;
}

export function ConversationList({
  conversations,
  selectedId,
  liveUnread,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
  onPreCarregar,
  onVisiveis,
  relogio,
  saindo,
}: {
  conversations: ConversationSummary[];
  /**
   * A conversa que acabou de ser resolvida e está saindo daqui.
   *
   * Só vem preenchida quando o recorte atual REALMENTE não mostra o que
   * já terminou — em "Resolvidas", ou sem filtro de estado, a conversa
   * continua na lista e animá-la seria mentir sobre o que aconteceu.
   */
  saindo?: string | null;
  /**
   * Expediente e fuso da empresa, pro selo de espera saber quando calar.
   *
   * Vem de cima porque a lista é redesenhada a cada mensagem que chega, e
   * buscar a configuração aqui dentro seria uma requisição por render.
   */
  relogio: Relogio;
  selectedId: string | null;
  /** Não lidas que chegaram via socket depois do último carregamento. */
  liveUnread?: Record<string, number>;
  loading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onSelect: (id: string) => void;
  /**
   * O ponteiro parou sobre uma conversa: é a deixa pra trazê-la antes do
   * clique. Entre pousar o mouse e clicar passam uns 200-400ms — quase
   * sempre o bastante pra ela abrir sem "carregando".
   */
  onPreCarregar?: (id: string) => void;
  /**
   * Quais conversas estão na tela agora, na ordem da lista — avisado um
   * pouco depois de a rolagem parar, pra o Inbox trazer o começo delas em
   * segundo plano.
   */
  onVisiveis?: (ids: string[]) => void;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const minuto = useMinuto();

  // As linhas na tela. Um observador só pra lista inteira; o aviso sai
  // 400ms depois do último movimento, então rolar rápido por cem conversas
  // não vira cem avisos — só o lugar onde a rolagem parou conta.
  useEffect(() => {
    const area = areaRef.current;
    if (!area || !onVisiveis) return;

    const naTela = new Set<string>();
    let espera: ReturnType<typeof setTimeout> | null = null;
    const avisar = () => {
      espera = null;
      const ordem = [...area.querySelectorAll<HTMLElement>("[data-conversa-id]")]
        .map((linha) => linha.dataset.conversaId as string)
        .filter((id) => naTela.has(id));
      onVisiveis(ordem);
    };

    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          const id = (entrada.target as HTMLElement).dataset.conversaId;
          if (!id) continue;
          if (entrada.isIntersecting) naTela.add(id);
          else naTela.delete(id);
        }
        if (espera) clearTimeout(espera);
        espera = setTimeout(avisar, 400);
      },
      { root: area },
    );
    area
      .querySelectorAll("[data-conversa-id]")
      .forEach((linha) => observador.observe(linha));

    return () => {
      observador.disconnect();
      if (espera) clearTimeout(espera);
    };
  }, [onVisiveis, conversations]);

  // Rolagem infinita: um observador na última linha dispara a próxima
  // página antes de a pessoa chegar no fim, então a lista parece não ter
  // fim em vez de dar um solavanco de carregamento.
  useEffect(() => {
    const element = sentinelRef.current;
    if (!element || !hasMore || !onLoadMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onLoadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, conversations.length]);

  if (loading) {
    return (
      <div className="flex flex-col gap-1 overflow-y-auto p-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-start gap-3 py-1.5">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <EmptyState
          icon={MessageSquareDashed}
          title="Nenhuma conversa aqui"
          description="Ajuste os filtros acima ou espere alguém mandar mensagem."
        />
      </div>
    );
  }

  return (
    <div ref={areaRef} data-tour="lista" className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col py-1.5">
      {conversations.map((conversation, indice) => (
        <LinhaDaConversa
          key={conversation.id}
          conversation={conversation}
          // O contador do banco é a verdade; o do socket cobre o intervalo
          // entre a última busca e agora, sem precisar refazer a lista.
          unread={Math.max(conversation.unreadCount, liveUnread?.[conversation.id] ?? 0)}
          selected={selectedId === conversation.id}
          saindo={saindo === conversation.id}
          animavel={indice < 20}
          relogio={relogio}
          minuto={minuto}
          onSelect={onSelect}
          onPreCarregar={onPreCarregar}
        />
      ))}
      </div>

      {hasMore ? (
        <div ref={sentinelRef} className="flex justify-center py-3">
          <span className="text-xs text-muted-foreground">
            {loadingMore ? "Carregando..." : " "}
          </span>
        </div>
      ) : null}
    </div>
  );
}
