/**
 * O espaço da empresa: texto das conversas + arquivos guardados.
 * As contas de "quanto falta" e "quando avisar", fora da tela.
 */

export interface EstadoDoArmazenamento {
  usadoBytes: number;
  cotaBytes: number;
  /** Apagar as mensagens mais antigas sozinho quando encher. */
  limpezaAutomatica: boolean;
}

/** A partir de quanto o painel avisa. */
export const AVISAR_A_PARTIR_DE = 0.9;

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1).replace(".", ",")} MB`;
  const gb = bytes / 1024 ** 3;
  return `${(gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)).replace(".", ",")} GB`;
}

export interface AvisoDeArmazenamento {
  cheio: boolean;
  porcento: number;
  titulo: string;
  detalhe: string;
}

/**
 * O que dizer quando o espaço aperta — ou nada, abaixo de 90%.
 *
 * Nunca é bloqueio: mensagem continua chegando com a cota estourada
 * (perder atendimento seria pior que passar do limite). O aviso existe
 * pra que a limpeza, quando acontecer, não pegue ninguém de surpresa.
 */
export function avisoDeArmazenamento(
  estado: EstadoDoArmazenamento | null | undefined,
): AvisoDeArmazenamento | null {
  if (!estado || estado.cotaBytes <= 0) return null;
  const fracao = estado.usadoBytes / estado.cotaBytes;
  if (fracao < AVISAR_A_PARTIR_DE) return null;

  const porcento = Math.min(100, Math.floor(fracao * 100));
  const conta = `${tamanhoLegivel(estado.usadoBytes)} de ${tamanhoLegivel(estado.cotaBytes)}`;
  const cheio = fracao >= 1;

  if (estado.limpezaAutomatica) {
    return {
      cheio,
      porcento,
      titulo: cheio ? "Armazenamento cheio" : `Armazenamento em ${porcento}%`,
      detalhe: cheio
        ? `${conta}. As mensagens mais antigas estão sendo apagadas pra liberar espaço.`
        : `${conta}. Ao encher, as mensagens mais antigas são apagadas automaticamente, das mais velhas pras mais novas.`,
    };
  }
  return {
    cheio,
    porcento,
    titulo: cheio ? "Armazenamento cheio" : `Armazenamento em ${porcento}%`,
    detalhe: cheio
      ? `${conta}. As mensagens continuam chegando, mas é hora de liberar espaço.`
      : `${conta}. Escolha um prazo de guarda ou ligue a limpeza automática antes de encher.`,
  };
}
