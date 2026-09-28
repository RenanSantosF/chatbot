import { apiFetch } from "./api-client";

/**
 * A foto de perfil mais nova que a tela já conhece, por cliente.
 *
 * O mesmo cliente aparece em três lugares ao mesmo tempo — linha da lista,
 * cabeçalho da conversa e ficha ao lado —, cada um com a cópia do cliente
 * que veio na sua própria resposta da API. Quando a foto é buscada de novo,
 * as três precisam trocar juntas, sem cada tela repassar a novidade pra
 * outra. Este registro é o ponto de encontro: `AvatarDoCliente` lê daqui
 * antes de usar a URL que recebeu.
 */
const fotos = new Map<string, string | null>();
const ouvintes = new Set<() => void>();

export function assinarFotos(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

/** `undefined` quando esta tela ainda não buscou a foto desse cliente. */
export function fotoConhecida(clienteId: string): string | null | undefined {
  return fotos.get(clienteId);
}

function registrar(clienteId: string, url: string | null) {
  if (fotos.get(clienteId) === url) return;
  fotos.set(clienteId, url);
  ouvintes.forEach((ouvinte) => ouvinte());
}

/** Quem já foi conferido nesta aba, pra abrir de novo a conversa não repetir. */
const conferidos = new Set<string>();
const emAndamento = new Map<string, Promise<string | null | undefined>>();

/**
 * Busca a foto no WhatsApp, pela API.
 *
 * Sem `forcar`, é a conferência de quem abriu a conversa: uma vez por aba,
 * e o servidor ainda decide se a foto guardada está nova o bastante pra
 * nem perguntar. Com `forcar` (o clique na foto), pergunta de novo.
 *
 * Devolve `undefined` quando a busca falhou — quem chamou fica com a foto
 * que já tinha.
 */
export function atualizarFoto(
  clienteId: string,
  { forcar = false }: { forcar?: boolean } = {},
): Promise<string | null | undefined> {
  if (!forcar && conferidos.has(clienteId)) {
    return Promise.resolve(fotos.get(clienteId));
  }
  const pendente = emAndamento.get(clienteId);
  if (pendente) return pendente;

  conferidos.add(clienteId);
  const pedido = apiFetch<{ avatarUrl: string | null }>(
    `/customers/${clienteId}/foto${forcar ? "?forcar=1" : ""}`,
    { method: "POST" },
  )
    .then(({ avatarUrl }) => {
      registrar(clienteId, avatarUrl);
      return avatarUrl;
    })
    .catch(() => undefined)
    .finally(() => emAndamento.delete(clienteId));

  emAndamento.set(clienteId, pedido);
  return pedido;
}
