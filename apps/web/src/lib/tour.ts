import { apiFetch } from "@/lib/api-client";

/**
 * As contas do tour guiado que não precisam de tela: onde o cartão de
 * explicação fica em relação ao que está sendo mostrado, e se o tour já
 * foi visto por esta pessoa.
 */

export interface Caixa {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type Lado = "direita" | "esquerda" | "baixo" | "cima" | "centro";

const MARGEM = 16;
const DISTANCIA = 18;

/**
 * Onde o cartão cabe melhor: do lado com mais espaço, na ordem em que a
 * leitura flui (direita, baixo, cima, esquerda). Sem alvo, no centro. O
 * resultado sempre fica dentro da tela — encostado na borda, se preciso.
 */
export function posicionarCartao(
  alvo: Caixa | null,
  tela: { width: number; height: number },
  cartao: { width: number; height: number },
): { top: number; left: number; lado: Lado } {
  const prender = (valor: number, min: number, max: number) =>
    Math.min(Math.max(valor, min), Math.max(min, max));

  if (!alvo) {
    return {
      top: Math.max(MARGEM, (tela.height - cartao.height) / 2),
      left: Math.max(MARGEM, (tela.width - cartao.width) / 2),
      lado: "centro",
    };
  }

  const espaco = {
    direita: tela.width - (alvo.left + alvo.width),
    esquerda: alvo.left,
    baixo: tela.height - (alvo.top + alvo.height),
    cima: alvo.top,
  };
  const cabe = {
    direita: espaco.direita >= cartao.width + DISTANCIA + MARGEM,
    esquerda: espaco.esquerda >= cartao.width + DISTANCIA + MARGEM,
    baixo: espaco.baixo >= cartao.height + DISTANCIA + MARGEM,
    cima: espaco.cima >= cartao.height + DISTANCIA + MARGEM,
  };
  const lado: Exclude<Lado, "centro"> = cabe.direita
    ? "direita"
    : cabe.baixo
      ? "baixo"
      : cabe.cima
        ? "cima"
        : cabe.esquerda
          ? "esquerda"
          : // Alvo enorme (a lista inteira, o painel): o cartão vai por
            // cima dele, do lado que tiver mais folga.
            espaco.direita >= espaco.esquerda
            ? "direita"
            : "esquerda";

  const centroY = alvo.top + alvo.height / 2 - cartao.height / 2;
  const centroX = alvo.left + alvo.width / 2 - cartao.width / 2;
  const maxTop = tela.height - cartao.height - MARGEM;
  const maxLeft = tela.width - cartao.width - MARGEM;

  switch (lado) {
    case "direita":
      return {
        top: prender(centroY, MARGEM, maxTop),
        left: prender(alvo.left + alvo.width + DISTANCIA, MARGEM, maxLeft),
        lado,
      };
    case "esquerda":
      return {
        top: prender(centroY, MARGEM, maxTop),
        left: prender(alvo.left - cartao.width - DISTANCIA, MARGEM, maxLeft),
        lado,
      };
    case "baixo":
      return {
        top: prender(alvo.top + alvo.height + DISTANCIA, MARGEM, maxTop),
        left: prender(centroX, MARGEM, maxLeft),
        lado,
      };
    case "cima":
      return {
        top: prender(alvo.top - cartao.height - DISTANCIA, MARGEM, maxTop),
        left: prender(centroX, MARGEM, maxLeft),
        lado,
      };
  }
}

const CHAVE = "inteliwa:tour:";

/**
 * Esta pessoa já viu (ou pulou) o tour?
 *
 * Quem decide é a CONTA (`tourVisto`, vindo de /auth/me): trocar de
 * navegador ou de computador não repete o tour. A marca no navegador só
 * cobre o intervalo entre fechar o tour e a sessão ser lida de novo — sem
 * ela, uma troca de tela logo depois de pular podia trazê-lo de volta.
 */
export function tourJaVisto(
  userId: string,
  naConta: boolean | undefined,
): boolean {
  if (naConta) return true;
  try {
    return localStorage.getItem(CHAVE + userId) !== null;
  } catch {
    return false;
  }
}

/** Grava na conta (e no navegador, pro intervalo até a sessão recarregar). */
export function marcarTourVisto(userId: string, como: "concluido" | "pulado") {
  try {
    localStorage.setItem(CHAVE + userId, como);
  } catch {
    // Sem armazenamento: a conta basta.
  }
  void apiFetch("/auth/tour-visto", { method: "POST" }).catch(() => undefined);
}

/** Pede o tour de qualquer lugar do painel (ex.: "Fazer o tour" nos primeiros passos). */
export const EVENTO_INICIAR_TOUR = "inteliwa:iniciar-tour";

export function iniciarTour() {
  window.dispatchEvent(new Event(EVENTO_INICIAR_TOUR));
}
