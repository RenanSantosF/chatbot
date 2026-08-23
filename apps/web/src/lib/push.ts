import { apiFetch } from "@/lib/api-client";

/**
 * O lado do navegador do aviso com o painel fechado.
 *
 * Fica separado do RealtimeProvider porque é outra natureza de código:
 * lá é estado de tela, aqui é conversa com APIs do navegador que falham de
 * jeitos específicos (recurso ausente, permissão negada, chave trocada).
 * Nada aqui lança — quem chama só precisa saber se deu certo.
 */

/**
 * A chave VAPID vem em base64url e o navegador quer bytes.
 *
 * Não é conversão à toa: `applicationServerKey` recusa a string, e o erro
 * que ele dá ("InvalidCharacterError") não diz nada sobre o formato.
 */
function chaveEmBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const preenchimento = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + preenchimento).replace(/-/g, "+").replace(/_/g, "/");
  const cru = window.atob(base64);
  // O buffer é criado explicitamente pra o tipo ser `Uint8Array<ArrayBuffer>`
  // e não o `ArrayBufferLike` genérico: `applicationServerKey` recusa o
  // segundo, porque ele admitiria memória compartilhada.
  const bytes = new Uint8Array(new ArrayBuffer(cru.length));
  for (let i = 0; i < cru.length; i += 1) bytes[i] = cru.charCodeAt(i);
  return bytes;
}

/** O navegador tem o que é preciso pra receber aviso com o app fechado? */
export function suportaPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Registra o service worker e inscreve este aparelho.
 *
 * Chamado depois de a pessoa autorizar as notificações — nunca antes.
 * Pedir permissão sem que ela tenha pedido nada é o caminho mais rápido
 * pra ela clicar em "bloquear" e o recurso morrer pra sempre naquele
 * navegador.
 *
 * @returns true quando este aparelho passou a receber avisos.
 */
export async function inscreverParaAvisos(): Promise<boolean> {
  if (!suportaPush()) return false;

  try {
    const { chavePublica } = await apiFetch<{ chavePublica: string | null }>(
      "/push/chave",
    );
    // Servidor sem VAPID configurado: o recurso está desligado, e tentar
    // inscrever só produziria um erro sem tradução possível pra tela.
    if (!chavePublica) return false;

    const registro = await navigator.serviceWorker.register("/sw.js");
    // Sem esperar por isto, `pushManager` pode ser chamado num registro que
    // ainda não terminou de ativar, e a inscrição falha na primeira vez —
    // justamente a vez em que a pessoa está olhando.
    await navigator.serviceWorker.ready;

    /*
     * Reaproveita a inscrição existente quando ela é da mesma chave.
     *
     * Se a chave do servidor mudou, a inscrição velha aponta pra um
     * remetente que não é mais autorizado e nenhum aviso chega. Cancelar e
     * refazer é o que conserta — e é invisível pra quem usa.
     */
    const existente = await registro.pushManager.getSubscription();
    if (existente) {
      const mesmaChave =
        existente.options.applicationServerKey &&
        new Uint8Array(existente.options.applicationServerKey).toString() ===
          chaveEmBytes(chavePublica).toString();
      if (!mesmaChave) await existente.unsubscribe();
    }

    const inscricao =
      (await registro.pushManager.getSubscription()) ??
      (await registro.pushManager.subscribe({
        // O protocolo permite avisos silenciosos, mas os navegadores os
        // recusam na prática: sem esta linha a inscrição é negada.
        userVisibleOnly: true,
        applicationServerKey: chaveEmBytes(chavePublica),
      }));

    const chaves = inscricao.toJSON().keys;
    if (!chaves?.p256dh || !chaves?.auth) return false;

    await apiFetch("/push/inscrever", {
      method: "POST",
      body: JSON.stringify({
        endpoint: inscricao.endpoint,
        p256dh: chaves.p256dh,
        auth: chaves.auth,
        userAgent: navigator.userAgent.slice(0, 300),
      }),
    });

    return true;
  } catch {
    // Falhar aqui deixa o aviso da própria página valendo, que é o
    // comportamento de antes — pior que o ideal, melhor que nada.
    return false;
  }
}

/**
 * Tira este aparelho da lista, no navegador e no servidor.
 *
 * Os dois lados importam: cancelar só no navegador deixaria o servidor
 * empurrando avisos pra um endereço morto até a primeira falha, e apagar
 * só no servidor deixaria o navegador achando que ainda está inscrito —
 * e ele não se reinscreve enquanto achar isso.
 */
export async function cancelarAvisos(): Promise<void> {
  if (!suportaPush()) return;

  try {
    const registro = await navigator.serviceWorker.getRegistration();
    const inscricao = await registro?.pushManager.getSubscription();
    if (!inscricao) return;

    await apiFetch("/push/inscrever", {
      method: "DELETE",
      body: JSON.stringify({ endpoint: inscricao.endpoint }),
    }).catch(() => undefined);

    await inscricao.unsubscribe();
  } catch {
    // Sem service worker registrado não há o que cancelar.
  }
}

/** Este aparelho já está inscrito? Usado pra a página não duplicar o aviso. */
export async function estaInscrito(): Promise<boolean> {
  if (!suportaPush()) return false;
  try {
    const registro = await navigator.serviceWorker.getRegistration();
    return Boolean(await registro?.pushManager.getSubscription());
  } catch {
    return false;
  }
}
