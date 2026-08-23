"use client";

import {
  ArrowDownWideNarrow,
  Clock3,
  Inbox,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/priority";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { TagChip } from "./tag-picker";
import type { ConversationPriority, ConversationStatus, Tag } from "@/lib/types";

/** Os três grupos de trabalho vindos da API (ver STATUS_GROUPS no backend). */
export type StatusGroup = "PENDING" | "WAITING" | "DONE";

/**
 * Duas leituras da mesma caixa.
 *
 * RECENTE é a de mensageiro — quem falou por último em cima — e continua
 * sendo o padrão, porque é o que a memória muscular espera.
 *
 * ESPERA é a fila de atendimento. As duas discordam justamente onde dói: o
 * cliente que escreveu de manhã e não insistiu mais afunda na ordem por
 * recência, e é ele quem está sem resposta há mais tempo.
 */
export type OrdemDoInbox = "RECENTE" | "ESPERA";

export interface InboxFilters {
  /** Grupo de trabalho. "ALL" = não filtra. */
  grupo: StatusGroup | "ALL";
  /**
   * Mostrar os GRUPOS do WhatsApp em vez das conversas de cliente.
   *
   * Eixo à parte, e não mais uma faceta: as duas listas nunca se
   * misturam. Um grupo movimentado produz dezenas de mensagens por dia e
   * ficaria no topo o tempo todo, empurrando pra baixo o cliente que está
   * esperando — que é o oposto do que a caixa existe pra fazer.
   */
  grupos: boolean;
  status: ConversationStatus | "ALL";
  priority: ConversationPriority | "ALL";
  mine: boolean;
  unread: boolean;
  unassigned: boolean;
  /** Só o que a IA está conduzindo agora. */
  comIa: boolean;
  /** Só quem está esperando resposta da empresa. */
  waiting: boolean;
  ordem: OrdemDoInbox;
  /** Só as conversas com esta etiqueta. Vazio = todas. */
  tagId: string;
  search: string;
}

/**
 * Abre em "Pendentes", ordenado pela fila de espera.
 *
 * A tela existe pra responder "o que eu preciso fazer agora". Abrir com
 * tudo misturado — inclusive o que já foi resolvido — obriga a pessoa a
 * filtrar antes de começar a trabalhar, todo dia.
 *
 * A ordem por espera é a resposta certa pra essa mesma pergunta. Por
 * recência, quem cobra sobe e quem escreveu uma vez e ficou quieto afunda:
 * o cliente educado é o último a ser atendido, e ninguém percebe porque a
 * lista parece cheia de movimento. Quem quiser a leitura de mensageiro
 * troca em um clique — o contrário (descobrir que existe uma fila) exigia
 * que a pessoa procurasse.
 */
export const DEFAULT_FILTERS: InboxFilters = {
  grupo: "PENDING",
  grupos: false,
  status: "ALL",
  priority: "ALL",
  mine: false,
  unread: false,
  unassigned: false,
  comIa: false,
  waiting: false,
  ordem: "ESPERA",
  tagId: "",
  search: "",
};

/** Contagens vindas do servidor — refletem a base inteira, não a página. */
export interface FilterCounts {
  total: number;
  unread: number;
  mine: number;
  unassigned: number;
  comIa: number;
  esperando: number;
  pendentes: number;
  aguardando: number;
  resolvidas: number;
  status: Partial<Record<ConversationStatus, number>>;
  priority: Partial<Record<ConversationPriority, number>>;
}

const STATUS_ORDER: ConversationStatus[] = [
  "OPEN",
  "WAITING_AGENT",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
];

const STATUS_LABEL: Record<ConversationStatus, string> = {
  OPEN: "Abertas",
  WAITING_AGENT: "Aguard. atendente",
  WAITING_CUSTOMER: "Aguard. cliente",
  RESOLVED: "Resolvidas",
  CLOSED: "Fechadas",
};

/**
 * As abas, sem ícone.
 *
 * Cada uma tinha um, e eles saíram junto com a grade que os abrigava: numa
 * aba com rótulo escrito, o ícone não acrescenta leitura nenhuma e disputa
 * espaço com o número — que é a informação que se lê de relance.
 */
const GRUPOS: {
  value: StatusGroup | "ALL";
  label: string;
  ajuda: string;
}[] = [
  {
    value: "PENDING",
    label: "Pendentes",
    ajuda: "Precisa de uma pessoa — sem o que a IA está conduzindo",
  },
  {
    value: "WAITING",
    label: "Aguardando",
    ajuda: "Dentro de Pendentes: a bola está com o cliente",
  },
  { value: "DONE", label: "Resolvidas", ajuda: "Atendimento encerrado" },
  { value: "ALL", label: "Tudo", ajuda: "Sem filtro de situação" },
];

export function InboxFilterBar({
  value,
  counts,
  onChange,
  action,
}: {
  value: InboxFilters;
  counts: FilterCounts;
  onChange: (filters: InboxFilters) => void;
  /** Botão de ação que fica à direita da busca (ex.: simular cliente). */
  action?: React.ReactNode;
}) {
  const [maisAberto, setMaisAberto] = useState(
    value.status !== "ALL" || value.priority !== "ALL",
  );

  const set = <K extends keyof InboxFilters>(key: K, next: InboxFilters[K]) =>
    onChange({ ...value, [key]: next });

  /**
   * Grupo e "situação exata" são o MESMO eixo, em duas granularidades:
   * "Pendentes" e "Aguard. cliente" respondem a mesma pergunta. Escolher um
   * limpa o outro.
   *
   * Sem isso dava pra montar um recorte impossível — grupo Resolvidas com
   * situação Aberta — em que a lista mostrava uma coisa (o backend faz a
   * situação exata ganhar do grupo) e os botões diziam outra. Ninguém
   * escolhe isso de propósito; dá pra chegar lá clicando duas vezes.
   */
  const escolherGrupo = (grupo: InboxFilters["grupo"]) =>
    onChange({ ...value, grupo, status: "ALL" });

  const escolherStatus = (status: InboxFilters["status"]) =>
    onChange({ ...value, status, grupo: "ALL" });

  const contagemDoGrupo: Record<StatusGroup | "ALL", number> = {
    PENDING: counts.pendentes,
    WAITING: counts.aguardando,
    DONE: counts.resolvidas,
    ALL: counts.total,
  };

  /**
   * Há algo ESCONDENDO conversa da lista?
   *
   * É essa a pergunta que o "limpar" responde, e por isso a ordem ficou de
   * fora: trocar pra fila de espera não tira nada da tela, só muda a
   * sequência. Enquanto ela contava, escolher "Fila de espera" fazia
   * aparecer um "limpar" que sugeria haver um filtro ligado — e clicar nele
   * desfazia a ordenação junto, que ninguém tinha pedido pra desfazer.
   *
   * A etiqueta conta: ela recorta de verdade.
   */
  const refinando =
    value.status !== "ALL" ||
    value.priority !== "ALL" ||
    value.mine ||
    value.unread ||
    value.unassigned ||
    value.comIa ||
    value.waiting ||
    Boolean(value.tagId);

  const naFila = value.ordem === "ESPERA";

  /** Quantos refinamentos estão ligados, pra o ícone poder dizer. */
  const quantosRefinos =
    (value.status !== "ALL" ? 1 : 0) +
    (value.priority !== "ALL" ? 1 : 0) +
    (value.mine ? 1 : 0) +
    (value.unread ? 1 : 0) +
    (value.unassigned ? 1 : 0) +
    (value.comIa ? 1 : 0) +
    (value.waiting ? 1 : 0) +
    (value.tagId ? 1 : 0);

  const limpar = () =>
    onChange({
      ...DEFAULT_FILTERS,
      grupo: value.grupo,
      // O eixo sobrevive ao "limpar": quem está olhando os grupos não
      // pediu pra voltar pra caixa de clientes.
      grupos: value.grupos,
      // A ordem sobrevive ao "limpar" pelo mesmo motivo que não o liga: ela
      // não é um filtro, é como a pessoa prefere ler a lista.
      ordem: value.ordem,
      search: value.search,
    });

  /*
   * A barra tem DUAS linhas, e o resto mora atrás do ícone de filtro.
   *
   * Antes eram cinco blocos empilhados aqui — busca, grade de situação,
   * seletor de ordem, fileira de etiquetas e fileira de interruptores —
   * e no fim sobrava menos da metade da coluna pra lista de conversas,
   * que é a razão de a tela existir. Pior: tudo tinha o mesmo peso
   * visual, então nada guiava o olho.
   *
   * O que ficou à vista é o que se usa o dia inteiro: procurar alguém e
   * pular entre "o que precisa de mim", "o que espera o cliente" e "o que
   * já acabou". O resto — ordem, prioridade, situação exata, etiqueta,
   * meus/não lidos — é escolha de vez em quando, e vez em quando não
   * merece espaço permanente.
   */
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value.search}
            onChange={(event) => set("search", event.target.value)}
            placeholder="Buscar cliente..."
            className="h-10 rounded-full border-transparent bg-muted pl-9 text-[13px] shadow-none"
          />
        </div>

        <button
          type="button"
          aria-expanded={maisAberto}
          aria-label={
            quantosRefinos > 0
              ? `Filtros — ${quantosRefinos} ligado(s)`
              : "Filtros"
          }
          title="Mais filtros"
          onClick={() => setMaisAberto((aberto) => !aberto)}
          className={cn(
            "relative flex size-10 shrink-0 items-center justify-center rounded-full transition-colors",
            maisAberto || quantosRefinos > 0
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <SlidersHorizontal className="size-4.5" />
          {/* Um ponto, não um número: quem tem filtro ligado já sabe qual
              é — o que ele precisa saber de relance é que a lista não
              está mostrando tudo. */}
          {quantosRefinos > 0 ? (
            <span
              aria-hidden
              className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-card"
            />
          ) : null}
        </button>
        {action}
      </div>

      {/* As três (quatro) leituras da caixa, como abas.

          Sublinhado em vez de pílula: aba é a metáfora certa pra "onde eu
          estou", e o sublinhado ocupa menos peso que um bloco colorido —
          o que chama atenção na linha passa a ser o número de cada uma,
          que é a informação que se lê de relance. */}
      <div
        role="radiogroup"
        aria-label="Situação do atendimento"
        className="flex items-stretch gap-0.5 border-b px-2"
      >
        {GRUPOS.map((grupo) => {
          const ativo = !value.grupos && value.grupo === grupo.value;
          const quantos = contagemDoGrupo[grupo.value];
          return (
            <button
              key={grupo.value}
              type="button"
              role="radio"
              aria-checked={ativo}
              title={grupo.ajuda}
              onClick={() => escolherGrupo(grupo.value)}
              className={cn(
                "-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-2 px-1 pt-1 pb-2.5 text-[13px] font-medium transition-colors",
                ativo
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="truncate">{grupo.label}</span>
              {quantos > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums",
                    ativo ? "bg-primary/15" : "bg-muted text-muted-foreground",
                  )}
                >
                  {quantos}
                </span>
              ) : null}
            </button>
          );
        })}

        {/* Os grupos do WhatsApp, à parte.

            Aba e não filtro porque as duas listas nunca se misturam: um
            grupo movimentado produz dezenas de mensagens por dia e ficaria
            no topo o tempo todo, empurrando pra baixo o cliente que está
            esperando. Separada por uma divisória porque ela não é mais uma
            situação — é outra caixa. */}
        <span aria-hidden className="my-2 w-px shrink-0 bg-border" />
        <button
          type="button"
          role="radio"
          aria-checked={value.grupos}
          title="Conversas de grupo do WhatsApp"
          onClick={() => set("grupos", !value.grupos)}
          className={cn(
            "-mb-px flex shrink-0 items-center justify-center gap-1.5 border-b-2 px-3 pt-1 pb-2.5 text-[13px] font-medium transition-colors",
            value.grupos
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Users className="size-4" />
          Grupos
        </button>
      </div>

      {/* O painel desce de cima, e some quando fecha.

          `grid-rows-[0fr]` pra `[1fr]` anima a ALTURA sem ninguém precisar
          medir o conteúdo — é o que permite o painel ter tamanho variável
          (a fileira de etiquetas aparece só em quem etiqueta) e ainda
          assim abrir liso. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          maisAberto ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b px-3 py-3">
            <Secao titulo="Ordem da lista">
              <div
                role="radiogroup"
                aria-label="Ordem da lista"
                className="flex items-center gap-1 rounded-lg bg-muted p-0.5"
              >
                <OpcaoDeOrdem
                  ativa={!naFila}
                  onClick={() => set("ordem", "RECENTE")}
                  icone={Clock3}
                  rotulo="Mais recentes"
                  ajuda="Quem falou por último em cima, como num mensageiro."
                />
                <OpcaoDeOrdem
                  ativa={naFila}
                  onClick={() => set("ordem", "ESPERA")}
                  icone={ArrowDownWideNarrow}
                  rotulo="Fila de espera"
                  ajuda="Quem está sem resposta há mais tempo primeiro."
                />
              </div>
            </Secao>

            <Secao titulo="Recortes">
              {/* Somam-se ao grupo, como interruptores: dá pra ver "minhas
                  pendentes", coisa que opções exclusivas não permitiam. */}
              <div className="flex flex-wrap gap-1">
                <Interruptor
                  ligado={value.mine}
                  onToggle={() => set("mine", !value.mine)}
                  rotulo="Minhas"
                  quantos={counts.mine}
                />
                <Interruptor
                  ligado={value.unread}
                  onToggle={() => set("unread", !value.unread)}
                  rotulo="Não lidas"
                  quantos={counts.unread}
                />
                <Interruptor
                  ligado={value.unassigned}
                  onToggle={() => set("unassigned", !value.unassigned)}
                  rotulo="Sem dono"
                  quantos={counts.unassigned}
                />
                <Interruptor
                  ligado={value.waiting}
                  onToggle={() => set("waiting", !value.waiting)}
                  rotulo="Esperando"
                  quantos={counts.esperando}
                />
                {/* Fora de "Pendentes" por padrão: conversa que a IA conduz
                    não espera ninguém da equipe. Este interruptor é o
                    caminho de quem quer auditar o que ela anda
                    respondendo. */}
                <Interruptor
                  ligado={value.comIa}
                  onToggle={() => set("comIa", !value.comIa)}
                  rotulo="Com a IA"
                  quantos={counts.comIa}
                />
              </div>
            </Secao>

            <EtiquetasDoFiltro
              escolhida={value.tagId}
              onEscolher={(tagId) => set("tagId", tagId)}
            />

            <Grupo
              titulo="Situação exata"
              value={value.status}
              onChange={(next) => escolherStatus(next as InboxFilters["status"])}
              options={[
                { value: "ALL", label: "Todas" },
                ...STATUS_ORDER.map((status) => ({
                  value: status,
                  label: STATUS_LABEL[status],
                  count: counts.status[status] ?? 0,
                })),
              ]}
            />
            <Grupo
              titulo="Prioridade"
              value={value.priority}
              onChange={(next) => set("priority", next as InboxFilters["priority"])}
              options={[
                { value: "ALL", label: "Qualquer" },
                ...PRIORITY_ORDER.map((priority) => ({
                  value: priority,
                  label: PRIORITY_META[priority].label,
                  count: counts.priority[priority] ?? 0,
                  dot: PRIORITY_META[priority].dot,
                })),
              ]}
            />

            {refinando ? (
              <button
                type="button"
                onClick={limpar}
                className="flex items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
                Limpar filtros
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Um bloco do painel: título miúdo em cima, conteúdo embaixo. */
function Secao({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {titulo}
      </span>
      {children}
    </div>
  );
}

/**
 * Uma das duas posições do seletor de ordem.
 *
 * A acesa fica com fundo claro e sombra, do jeito que um controle
 * segmentado se comporta em qualquer sistema: a posição levantada é onde
 * você está, a rebaixada é pra onde dá pra ir.
 */
function OpcaoDeOrdem({
  ativa,
  onClick,
  icone: Icone,
  rotulo,
  ajuda,
}: {
  ativa: boolean;
  onClick: () => void;
  icone: typeof Inbox;
  rotulo: string;
  ajuda: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativa}
      onClick={onClick}
      title={ajuda}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
        ativa
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icone className="size-3.5 shrink-0" />
      {rotulo}
    </button>
  );
}

function Interruptor({
  ligado,
  onToggle,
  rotulo,
  quantos,
}: {
  ligado: boolean;
  onToggle: () => void;
  rotulo: string;
  quantos: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={ligado}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        ligado
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {ligado ? <X className="size-3" /> : null}
      {rotulo}
      <span className="tabular-nums opacity-70">{quantos}</span>
    </button>
  );
}

/**
 * Filtro secundário em linhas que QUEBRAM, não que rolam. Rolagem
 * horizontal escondida some com opção sem avisar; quebrar linha custa
 * altura, mas mostra tudo o que existe.
 */
function Grupo({
  titulo,
  value,
  options,
  onChange,
}: {
  titulo: string;
  value: string;
  options: { value: string; label: string; count?: number; dot?: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {titulo}
      </span>
      <div role="radiogroup" aria-label={titulo} className="flex flex-wrap gap-1">
        {options.map((option) => {
          const ativo = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={ativo}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors",
                ativo
                  ? "bg-primary/15 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {option.dot ? (
                <span className={cn("size-1.5 rounded-full", option.dot)} aria-hidden />
              ) : null}
              {option.label}
              {option.count ? (
                <span className="tabular-nums opacity-70">{option.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Fileira de etiquetas, e nada quando não há etiqueta nenhuma.
 *
 * Discreta por padrão: numa empresa que não usa etiquetas, esta linha
 * simplesmente não existe — nenhum espaço ocupado, nenhuma opção vazia
 * convidando a clicar. Quem começa a etiquetar vê a fileira aparecer
 * sozinha.
 *
 * Uma por vez, e não várias somadas: "orçamento E reclamação" é uma
 * pergunta que quase ninguém faz, e a barra que deixasse combinar viraria o
 * formulário que o Inbox passou o tempo todo evitando.
 */
function EtiquetasDoFiltro({
  escolhida,
  onEscolher,
}: {
  escolhida: string;
  onEscolher: (tagId: string) => void;
}) {
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    apiFetch<Tag[]>("/tags")
      .then(setTags)
      .catch(() => setTags([]));
  }, []);

  if (tags.length === 0) return null;

  return (
    <div role="radiogroup" aria-label="Filtrar por etiqueta" className="flex flex-wrap gap-1">
      {tags.map((tag) => {
        const ativa = escolhida === tag.id;
        return (
          <button
            key={tag.id}
            type="button"
            role="radio"
            aria-checked={ativa}
            // Clicar na que já está ligada desliga: é a saída óbvia, e
            // evita um botão "todas" só pra limpar um filtro.
            onClick={() => onEscolher(ativa ? "" : tag.id)}
            className={cn(
              "rounded-full transition-opacity",
              ativa
                ? "ring-2 ring-primary/50"
                : "opacity-70 hover:opacity-100",
            )}
          >
            <TagChip tag={tag} className="px-2 py-0.5" />
          </button>
        );
      })}
    </div>
  );
}
