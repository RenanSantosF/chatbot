/**
 * O "Sincronizando" que aparece quando a conexão volta depois de cair.
 *
 * O servidor não reenvia os eventos perdidos durante a queda, então as
 * telas buscam tudo de novo ao reconectar. Este controle decide quando o
 * aviso acende e apaga:
 *
 * - Acende só numa RECONEXÃO. Na primeira conexão da aba não há nada
 *   perdido, e acender a cada abertura do painel seria ruído.
 * - Fica aceso enquanto houver trabalho registrado (`registrar`), por no
 *   mínimo `minimo` ms, pra não virar um piscar que ninguém consegue ler.
 * - Sem nenhum trabalho registrado (telas que não recarregam nada, fora do
 *   Inbox), apaga sozinho depois de `semTrabalho` ms.
 *
 * `registrar` e `voltou` podem chegar em qualquer ordem: os dois ouvem o
 * mesmo evento de conexão do socket, e a ordem dos ouvintes não é
 * garantida.
 */
export interface Sincronia {
  /** A conexão caiu. */
  caiu: () => void;
  /** A conexão voltou. */
  voltou: () => void;
  /** Uma tela está recarregando depois da volta. */
  registrar: (trabalho: Promise<unknown>) => void;
  /** Desarma os relógios, sem mudar o estado (desmontagem). */
  encerrar: () => void;
}

export function criarSincronia(
  aoMudar: (aceso: boolean) => void,
  opcoes: { semTrabalho: number; minimo: number },
): Sincronia {
  /** Houve queda ainda não seguida de volta. */
  let caiu = false;
  let aceso = false;
  let pendentes = 0;
  let acesoDesde = 0;
  let apagarTimer: ReturnType<typeof setTimeout> | null = null;
  let semTrabalhoTimer: ReturnType<typeof setTimeout> | null = null;

  const acender = () => {
    if (apagarTimer) {
      clearTimeout(apagarTimer);
      apagarTimer = null;
    }
    if (aceso) return;
    aceso = true;
    acesoDesde = Date.now();
    aoMudar(true);
  };

  const apagarJa = () => {
    apagarTimer = null;
    if (pendentes > 0 || !aceso) return;
    aceso = false;
    aoMudar(false);
  };

  const apagar = () => {
    if (apagarTimer) clearTimeout(apagarTimer);
    const restante = opcoes.minimo - (Date.now() - acesoDesde);
    if (restante <= 0) {
      apagarJa();
      return;
    }
    apagarTimer = setTimeout(apagarJa, restante);
  };

  return {
    caiu: () => {
      caiu = true;
    },

    voltou: () => {
      if (!caiu) return;
      caiu = false;
      acender();
      if (semTrabalhoTimer) clearTimeout(semTrabalhoTimer);
      semTrabalhoTimer = setTimeout(() => {
        semTrabalhoTimer = null;
        if (pendentes === 0) apagar();
      }, opcoes.semTrabalho);
    },

    registrar: (trabalho) => {
      // Nem queda pendente nem aviso aceso: é a primeira conexão da aba.
      if (!caiu && !aceso) return;
      pendentes += 1;
      acender();
      void trabalho
        .catch(() => {})
        .finally(() => {
          pendentes -= 1;
          if (pendentes === 0) apagar();
        });
    },

    encerrar: () => {
      if (apagarTimer) clearTimeout(apagarTimer);
      if (semTrabalhoTimer) clearTimeout(semTrabalhoTimer);
      apagarTimer = null;
      semTrabalhoTimer = null;
    },
  };
}
