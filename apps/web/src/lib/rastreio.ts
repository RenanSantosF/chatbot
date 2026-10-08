"use client";

/**
 * Os passos de antes da conta, pro painel da plataforma.
 *
 * Anônimo de propósito: um id aleatório guardado no navegador, sem nome,
 * sem IP, sem cookie de terceiros. Serve só pra contar "quantas pessoas
 * visitaram, clicaram e abriram o cadastro" e ligar isso à conta criada
 * depois — o suficiente pra saber em que passo as pessoas desistem.
 */

// Ainda com o nome antigo da marca, de propósito: a chave não aparece pra
// ninguém, e trocá-la faria todo visitante que já passou pela landing
// contar como novo. O mesmo vale pras outras chaves "inteliwa:" guardadas
// no navegador (tour visto, avisos vistos, dica da correção).
const CHAVE_DO_VISITANTE = "inteliwa-visitante";
const CHAVE_DA_CAMPANHA = "inteliwa-utm";
const CAMPOS_DE_CAMPANHA = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

export type PassoDoVisitante = "landing_visita" | "landing_cta" | "cadastro_aberto";

/** O id anônimo deste navegador, criado na primeira visita. */
export function visitante(): string | null {
  try {
    let id = localStorage.getItem(CHAVE_DO_VISITANTE);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CHAVE_DO_VISITANTE, id);
    }
    return id;
  } catch {
    // Navegação privada, armazenamento bloqueado: segue sem contar.
    return null;
  }
}

/**
 * Guarda os utm_* da URL — a PRIMEIRA campanha que trouxe a pessoa.
 *
 * Primeiro toque, e não último: quem chegou por um anúncio do Instagram e
 * voltou dias depois digitando o endereço veio pelo anúncio.
 */
export function guardarCampanha() {
  try {
    if (localStorage.getItem(CHAVE_DA_CAMPANHA)) return;
    const busca = new URLSearchParams(window.location.search);
    const campanha: Record<string, string> = {};
    for (const campo of CAMPOS_DE_CAMPANHA) {
      const valor = busca.get(campo);
      if (valor) campanha[campo] = valor.slice(0, 80);
    }
    if (Object.keys(campanha).length) {
      localStorage.setItem(CHAVE_DA_CAMPANHA, JSON.stringify(campanha));
    }
  } catch {
    // Sem armazenamento, sem campanha — não é motivo pra atrapalhar nada.
  }
}

export function campanhaGuardada(): Record<string, string> | undefined {
  try {
    const bruto = localStorage.getItem(CHAVE_DA_CAMPANHA);
    return bruto ? (JSON.parse(bruto) as Record<string, string>) : undefined;
  } catch {
    return undefined;
  }
}

/** Manda um passo. Nunca atrapalha a página: falhou, ficou sem contar. */
export function registrarPasso(tipo: PassoDoVisitante) {
  const id = visitante();
  if (!id) return;
  try {
    void fetch("/api/plataforma/eventos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `keepalive`: o clique em "Começar" navega pra outra página na
      // mesma hora, e sem isto o pedido morria no meio da troca.
      keepalive: true,
      body: JSON.stringify({
        tipo,
        visitante: id,
        caminho: window.location.pathname,
        referencia: document.referrer || undefined,
        utm: campanhaGuardada(),
      }),
    }).catch(() => {});
  } catch {
    // idem
  }
}
