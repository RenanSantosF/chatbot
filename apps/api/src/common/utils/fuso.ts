/**
 * Datas no fuso da EMPRESA, nunca no do servidor.
 *
 * O servidor roda em UTC: "hoje" pro dono de uma clínica em São Paulo
 * começa às 03:00 UTC. Contar pelo relógio do servidor jogaria o movimento
 * das 21h no dia seguinte — e viraria o mês de uso da IA três horas antes.
 */

/** Os pedaços de data de `instante` como a empresa os vê no relógio dela. */
export function partes(fuso: string, instante: Date) {
  const valores = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(instante);
  const pegar = (tipo: string) =>
    valores.find((parte) => parte.type === tipo)?.value ?? '0';
  return {
    ano: Number(pegar('year')),
    mes: Number(pegar('month')),
    dia: Number(pegar('day')),
    hora: Number(pegar('hour')) % 24,
    minuto: Number(pegar('minute')),
    segundo: Number(pegar('second')),
    semana: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      pegar('weekday'),
    ),
  };
}

/** A meia-noite (no fuso da empresa) do dia em que `instante` cai. */
export function meiaNoite(fuso: string, instante: Date): Date {
  const p = partes(fuso, instante);
  const comoSeFosseUtc = Date.UTC(
    p.ano,
    p.mes - 1,
    p.dia,
    p.hora,
    p.minuto,
    p.segundo,
  );
  const deslocamento =
    comoSeFosseUtc - (instante.getTime() - (instante.getTime() % 1000));
  return new Date(Date.UTC(p.ano, p.mes - 1, p.dia) - deslocamento);
}

/** Quantos dias tem o mês (1–12) do ano. */
function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * A meia-noite do dia `dia` do mês, no fuso — com o dia 31 caindo no
 * último dia dos meses mais curtos (assinou dia 31, fevereiro vira dia 28).
 */
function diaDoMes(fuso: string, ano: number, mes: number, dia: number): Date {
  const certo = Math.min(dia, diasNoMes(ano, mes));
  // Meio-dia UTC cai no mesmo dia em qualquer fuso do Brasil (e do mundo
  // habitado), então serve de âncora pra achar a meia-noite local.
  return meiaNoite(fuso, new Date(Date.UTC(ano, mes - 1, certo, 12)));
}

/**
 * O ciclo mensal que contém `agora`, contado a partir do dia `dia` de cada
 * mês: começa na meia-noite desse dia e acaba na do mesmo dia do mês
 * seguinte.
 */
export function cicloMensal(
  dia: number,
  fuso: string,
  agora = new Date(),
): { inicio: Date; fim: Date } {
  const p = partes(fuso, agora);
  let ano = p.ano;
  let mes = p.mes;
  let inicio = diaDoMes(fuso, ano, mes, dia);
  if (inicio.getTime() > agora.getTime()) {
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      ano -= 1;
    }
    inicio = diaDoMes(fuso, ano, mes, dia);
  }
  const proximoMes = mes === 12 ? 1 : mes + 1;
  const anoDoProximo = mes === 12 ? ano + 1 : ano;
  return { inicio, fim: diaDoMes(fuso, anoDoProximo, proximoMes, dia) };
}

/** O dia do mês (1–31) em que `instante` cai, no fuso da empresa. */
export function diaNoFuso(fuso: string, instante: Date): number {
  return partes(fuso, instante).dia;
}
