import type { InboxFilters } from "@/components/inbox/inbox-filters";

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

/**
 * O MESMO recorte alimenta a lista e os contadores.
 *
 * Montar a consulta em dois lugares foi o que fez os números do cabeçalho
 * discordarem da lista embaixo: "Pendentes 1" com "Minhas 5". Uma função
 * só, dois destinos.
 */
export function buildQuery(
  filters: InboxFilters,
  cursor?: string | null,
  caminho = "/conversations",
): string {
  const params = new URLSearchParams();
  const buscando = Boolean(filters.search.trim());
  // O eixo de grupos vem primeiro: ele decide QUAL caixa está aberta, e o
  // resto dos filtros recorta dentro dela.
  if (filters.grupos) params.set("grupos", "true");
  // A aba (situação) some da busca: procurar alguém só pra descobrir que
  // ele "não existe" porque a conversa está resolvida, numa aba diferente
  // da que estava aberta, é o tipo de resultado que faz a pessoa desistir
  // de confiar na busca. Sem esses dois, o servidor já devolve de toda
  // situação — os contadores das abas não mudam, porque `counts` já ignora
  // esta faceta por conta própria (ver `montarWhere`/`semSituacao`).
  if (!buscando) {
    if (filters.grupo !== "ALL") params.set("statusGroup", filters.grupo);
    if (filters.status !== "ALL") params.set("status", filters.status);
  }
  if (filters.priority !== "ALL") params.set("priority", filters.priority);
  // Interruptores independentes: dá pra pedir "minhas E não lidas", coisa
  // que a versão anterior (opções exclusivas) não permitia.
  if (filters.mine) params.set("mine", "true");
  if (filters.unread) params.set("unread", "true");
  if (filters.unassigned) params.set("unassigned", "true");
  if (filters.comIa) params.set("comIa", "true");
  if (filters.waiting) params.set("waiting", "true");
  if (filters.ordem !== "RECENTE") params.set("ordem", filters.ordem);
  // A etiqueta é recorte, não faceta: vai junto na contagem também, senão
  // o cabeçalho contaria fora do que a lista está mostrando.
  if (filters.tagId) params.set("tagId", filters.tagId);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `${caminho}?${query}` : caminho;
}

/** Nome do cookie que leva o recorte do Inbox até o servidor. */
export const COOKIE_DOS_FILTROS = "inbox-filtros";

/**
 * O recorte guardado no cookie, validado — ou `null`.
 *
 * O Inbox guarda os filtros no navegador, e o servidor, que monta a
 * primeira página junto com o HTML, não os enxergava: buscava a lista sem
 * filtro nenhum enquanto a tela dizia "Pendentes", e a lista certa só
 * aparecia depois, trocando por baixo do dedo. O cookie é a cópia que
 * viaja com o pedido da página.
 *
 * Só as chaves conhecidas, com o tipo do padrão: cookie é entrada do
 * navegador, e um valor estranho aqui viraria uma consulta estranha lá.
 * A busca de texto nunca vem — ela não sobrevive a recarregar a página.
 */
export function lerFiltrosDoCookie(
  bruto: string | undefined,
  padrao: InboxFilters,
): InboxFilters | null {
  if (!bruto) return null;
  try {
    const lido = JSON.parse(bruto) as Record<string, unknown>;
    const filtros = { ...padrao };
    for (const chave of Object.keys(padrao) as (keyof InboxFilters)[]) {
      if (chave === "search") continue;
      if (typeof lido[chave] === typeof padrao[chave]) {
        (filtros as Record<string, unknown>)[chave] = lido[chave];
      }
    }
    return filtros;
  } catch {
    return null;
  }
}

export function gravarFiltrosNoCookie(filtros: InboxFilters) {
  const valor = encodeURIComponent(JSON.stringify({ ...filtros, search: "" }));
  document.cookie = `${COOKIE_DOS_FILTROS}=${valor}; path=/; max-age=31536000; samesite=lax`;
}
