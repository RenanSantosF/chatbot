import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiFetchServer } from "@/lib/api-server";
import {
  COOKIE_DOS_FILTROS,
  DEFAULT_FILTERS,
  buildQuery,
  lerFiltrosDoCookie,
} from "@/lib/inbox-query";
import type { FilterCounts, InboxFilters } from "@/components/inbox/inbox-filters";
import type { ConversationDetail, ConversationSummary } from "@/lib/types";
import { InboxClient, type DadosIniciaisDoInbox } from "./inbox-client";

/**
 * A primeira página da lista sai JUNTO com o HTML.
 *
 * O Inbox era uma tela de cliente pura: o servidor mandava a casca vazia,
 * e só depois de baixar o JavaScript, hidratar e ler os filtros guardados
 * é que o navegador pedia as conversas. Quatro etapas em fila antes de
 * aparecer a primeira linha — e cada uma paga a latência da rede de novo.
 * Era por isso que abrir o Inbox parecia lento mesmo com o banco
 * respondendo em milissegundos.
 *
 * Buscando aqui, as conversas viajam dentro do documento, e a conversa que
 * a URL pede (`?c=`, que é como a notificação e o link compartilhado
 * chegam) vem junto com a primeira página de mensagens dela.
 *
 * Medido em build de produção, com 60ms de latência simulada, sobre 1.000
 * conversas e 50 mil mensagens: 681ms até a lista aparecer na tela antes,
 * 346ms depois — e três chamadas a menos saindo do navegador.
 *
 * Os pedidos saem em paralelo, e uma falha não derruba a tela: sem dados,
 * o componente de cliente busca sozinho, como antes.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  // O recorte que a pessoa deixou aberto (ver `lerFiltrosDoCookie`): a
  // primeira página sai com a lista DA ABA certa, e não com todas.
  const filtros =
    lerFiltrosDoCookie((await cookies()).get(COOKIE_DOS_FILTROS)?.value, DEFAULT_FILTERS) ??
    DEFAULT_FILTERS;
  const [inicial, ativacao] = await Promise.all([
    carregarPrimeiraPagina(filtros, c),
    // Conta recém-criada ainda não respondeu as boas-vindas: o primeiro
    // acesso vai pra visão geral, onde elas e os primeiros passos moram —
    // um Inbox vazio não diria o que fazer. Link direto pra uma conversa
    // (`?c=`) nunca é desviado.
    c
      ? Promise.resolve(null)
      : apiFetchServer<{ precisaDeBoasVindas: boolean }>("/onboarding").catch(() => null),
  ]);
  if (ativacao?.precisaDeBoasVindas) redirect("/dashboard/visao-geral");
  return <InboxClient inicial={inicial} />;
}

type DetalheDaApi = ConversationDetail & { messagesCursor: string | null };

async function carregarPrimeiraPagina(
  filtros: InboxFilters,
  conversaAberta?: string,
): Promise<DadosIniciaisDoInbox | null> {
  try {
    const [conversas, contadores, conversa] = await Promise.all([
      // A MESMA consulta que o navegador faria pra este recorte — é o que
      // permite a ele não pedir de novo (ver `mesmoRecorte`).
      apiFetchServer<{ items: ConversationSummary[]; nextCursor: string | null }>(
        buildQuery(filtros),
      ),
      apiFetchServer<FilterCounts>(buildQuery(filtros, null, "/conversations/counts")),
      // A conversa que a URL pede. Uma falha aqui — link antigo, conversa
      // apagada — não pode derrubar a lista inteira: vira `null`, e o
      // navegador busca e reporta o erro como sempre fez.
      conversaAberta
        ? apiFetchServer<DetalheDaApi>(`/conversations/${conversaAberta}`).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (!conversas || !contadores) return null;
    return { conversas, contadores, conversa, filtros };
  } catch {
    // API fora do ar, sessão expirando no meio do render: a tela ainda
    // abre, e o navegador tenta buscar por conta própria.
    return null;
  }
}
