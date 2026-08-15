/**
 * Há quanto tempo o cliente espera — e quando isso vira alarme.
 *
 * O relógio da espera é o `waitingSince` da conversa (ver a API): ele marca
 * a primeira mensagem sem resposta e não é reiniciado pelas seguintes.
 *
 * O que este módulo acrescenta é o EXPEDIENTE. Sem ele, uma conversa que
 * chegou às 18h05 aparecia em vermelho às 22h — como se alguém tivesse
 * falhado, quando na verdade a empresa estava fechada e ninguém deveria
 * estar olhando. Alarme que dispara sozinho de madrugada é alarme que a
 * equipe aprende a ignorar, e aí ele para de servir quando importa.
 *
 * Fora do expediente a espera continua sendo mostrada — o dado é
 * verdadeiro, o cliente está esperando mesmo — mas em tom neutro. Ela volta
 * a escalar quando a empresa reabre.
 *
 * A leitura do expediente é gêmea de `horario-comercial.ts`, na API. As
 * duas existem porque a decisão acontece nos dois lugares: lá pra IA saber
 * o que dizer, aqui pra a lista saber o que pintar. O formato guardado é o
 * mesmo, e é ele o contrato entre as duas.
 */

/** Faixas de cada dia da semana, domingo em "0", no formato do banco. */
export type Expediente = Record<string, [string, string][]>;

export interface Relogio {
  expediente: Expediente | null;
  /** Fuso da empresa (Tenant.timezone). O do navegador não serve. */
  fuso: string;
}

export type NivelDaEspera = "calma" | "atencao" | "grave";

export interface Espera {
  rotulo: string;
  nivel: NivelDaEspera;
  /** A empresa está fechada agora? Muda o tom, não o número. */
  foraDoExpediente: boolean;
}

/** "08:30" -> 510. Null pro que não for horário. */
function emMinutos(texto: unknown): number | null {
  if (typeof texto !== "string") return null;
  const partes = /^(\d{1,2}):(\d{2})$/.exec(texto.trim());
  if (!partes) return null;
  const horas = Number(partes[1]);
  const minutos = Number(partes[2]);
  if (horas > 23 || minutos > 59) return null;
  return horas * 60 + minutos;
}

/**
 * Que horas são pra empresa.
 *
 * `Intl` é o único jeito de fazer isso sem biblioteca de fuso: ele sabe de
 * horário de verão e de mudança de lei, coisas que uma conta com offset
 * fixo erra em silêncio. Funciona igual no navegador e no servidor.
 */
export function agoraNaEmpresa(fuso: string, agora: Date): { dia: number; minutos: number } {
  let partes: Intl.DateTimeFormatPart[];
  try {
    partes = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(agora);
  } catch {
    // Fuso inválido no cadastro não pode quebrar a lista de conversas.
    return { dia: agora.getDay(), minutos: agora.getHours() * 60 + agora.getMinutes() };
  }

  const pegar = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  const dias = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dia = dias.indexOf(pegar("weekday"));

  return {
    dia: dia === -1 ? agora.getUTCDay() : dia,
    // "24:00" acontece em alguns ambientes na meia-noite.
    minutos: (Number(pegar("hour")) % 24) * 60 + Number(pegar("minute")),
  };
}

/**
 * A empresa está atendendo agora?
 *
 * Expediente vazio é "não configurado", e aí atende sempre — o mesmo
 * comportamento de antes do recurso existir.
 */
export function dentroDoExpediente(relogio: Relogio, agora: Date): boolean {
  const dias = Object.keys(relogio.expediente ?? {});
  if (dias.length === 0) return true;

  const { dia, minutos } = agoraNaEmpresa(relogio.fuso, agora);
  const faixas = relogio.expediente?.[String(dia)] ?? [];

  return faixas.some((faixa) => {
    const inicio = emMinutos(faixa[0]);
    const fim = emMinutos(faixa[1]);
    if (inicio === null || fim === null) return false;
    return minutos >= inicio && minutos < fim;
  });
}

/** Uma hora pra aparecer, quatro pra virar problema. */
const MINUTOS_PRA_APARECER = 60;
const HORAS_PRA_VIRAR_PROBLEMA = 4;

/**
 * O selo de espera de uma conversa, ou nada quando não há o que mostrar.
 *
 * @param waitingSince ISO vindo da API; nulo = a bola não está com a gente
 */
export function descreverEspera(
  waitingSince: string | null | undefined,
  relogio: Relogio,
  agora: Date = new Date(),
): Espera | null {
  if (!waitingSince) return null;

  const minutos = Math.floor((agora.getTime() - new Date(waitingSince).getTime()) / 60000);
  if (!Number.isFinite(minutos) || minutos < MINUTOS_PRA_APARECER) return null;

  const horas = Math.floor(minutos / 60);
  const rotulo = horas < 24 ? `${horas}h` : `${Math.floor(horas / 24)}d`;
  const foraDoExpediente = !dentroDoExpediente(relogio, agora);

  return {
    rotulo,
    // Fechado nunca é "grave": a espera é real, mas não é falha de
    // ninguém, e pintar de vermelho o que ninguém podia atender ensina a
    // equipe a ignorar o vermelho.
    nivel: foraDoExpediente
      ? "calma"
      : horas >= HORAS_PRA_VIRAR_PROBLEMA
        ? "grave"
        : "atencao",
    foraDoExpediente,
  };
}
