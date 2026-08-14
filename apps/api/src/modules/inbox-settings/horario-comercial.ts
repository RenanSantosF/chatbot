/**
 * O expediente da empresa, e as contas que dependem dele.
 *
 * Vive separado do serviço porque é regra pura: entra um instante e uma
 * configuração, sai "está aberto?" e "quando abre de novo?". Nada disso
 * precisa de banco, e tudo isso precisa de teste — errar aqui faz a IA
 * prometer atendimento pra madrugada de domingo.
 *
 * O fuso é sempre o da empresa, nunca o do servidor: o Railway roda em UTC,
 * e três horas de diferença mudam o dia da semana perto da meia-noite.
 */

/** Domingo é 0, igual ao `getDay()` do JavaScript. */
export const DIAS_DA_SEMANA = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

/**
 * Uma faixa de atendimento num dia, em minutos desde a meia-noite.
 *
 * São duas faixas e não uma porque o horário de almoço existe: comércio que
 * fecha das 12h às 14h é o caso comum, não a exceção.
 */
export interface Faixa {
  inicio: number;
  fim: number;
}

/** As faixas de cada dia da semana, indexadas por `getDay()`. */
export type Expediente = Record<number, Faixa[]>;

/** "08:30" -> 510. Devolve null pro que não for um horário de verdade. */
export function lerHorario(texto: unknown): number | null {
  if (typeof texto !== 'string') return null;
  const partes = /^(\d{1,2}):(\d{2})$/.exec(texto.trim());
  if (!partes) return null;

  const horas = Number(partes[1]);
  const minutos = Number(partes[2]);
  if (horas > 23 || minutos > 59) return null;

  return horas * 60 + minutos;
}

/** 510 -> "08:30". */
export function escreverHorario(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return `${String(horas).padStart(2, '0')}:${String(resto).padStart(2, '0')}`;
}

/**
 * Transforma o Json guardado no banco num expediente confiável.
 *
 * A coluna é Json, então o que vem de lá é oficialmente desconhecido:
 * pode ter chave estranha, horário invertido, faixa sobreposta ou texto no
 * lugar de hora. Em vez de espalhar checagem por todo lado, tudo passa por
 * aqui uma vez e o resto do código trabalha com uma estrutura que sabe estar
 * inteira.
 *
 * Faixa inválida é descartada em silêncio: derrubar a resposta ao cliente
 * porque alguém digitou "8" em vez de "08:00" seria trocar um problema
 * pequeno por um grande.
 */
export function lerExpediente(valor: unknown): Expediente {
  const expediente: Expediente = {};
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return expediente;
  }

  for (const [chave, faixas] of Object.entries(valor as Record<string, unknown>)) {
    const dia = Number(chave);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) continue;
    if (!Array.isArray(faixas)) continue;

    const limpas: Faixa[] = [];
    for (const faixa of faixas) {
      if (!Array.isArray(faixa) || faixa.length !== 2) continue;
      const inicio = lerHorario(faixa[0]);
      const fim = lerHorario(faixa[1]);
      // Fim igual ao início é faixa de duração zero; fim antes do início é
      // uma tentativa de atravessar a meia-noite, que este formato não
      // representa (e que se escreve como duas faixas em dias diferentes).
      if (inicio === null || fim === null || fim <= inicio) continue;
      limpas.push({ inicio, fim });
    }

    if (limpas.length > 0) {
      expediente[dia] = limpas.sort((a, b) => a.inicio - b.inicio);
    }
  }

  return expediente;
}

/** Volta pro formato do banco, pra tela e a API falarem a mesma língua. */
export function escreverExpediente(
  expediente: Expediente,
): Record<string, [string, string][]> {
  const json: Record<string, [string, string][]> = {};
  for (const [dia, faixas] of Object.entries(expediente)) {
    json[dia] = faixas.map((faixa) => [
      escreverHorario(faixa.inicio),
      escreverHorario(faixa.fim),
    ]);
  }
  return json;
}

/**
 * Que horas são pra empresa.
 *
 * `Intl` é o único jeito de fazer isso sem uma biblioteca de fuso: ele sabe
 * de horário de verão, de mudança de lei e de fuso com meia hora de
 * diferença, coisas que uma conta com offset fixo erra em silêncio.
 */
export function agoraNaEmpresa(
  fuso: string,
  agora: Date = new Date(),
): { dia: number; minutos: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(agora);

  const pegar = (tipo: string) =>
    partes.find((parte) => parte.type === tipo)?.value ?? '';

  const abreviacoes = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dia = abreviacoes.indexOf(pegar('weekday'));
  // "24:00" acontece: alguns ambientes formatam a meia-noite assim em
  // hour12:false, e 24*60 estouraria o dia inteiro.
  const hora = Number(pegar('hour')) % 24;

  return {
    dia: dia === -1 ? agora.getUTCDay() : dia,
    minutos: hora * 60 + Number(pegar('minute')),
  };
}

/** Um fuso que o `Intl` não conhece não pode derrubar o atendimento. */
export function fusoValido(fuso: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso });
    return fuso;
  } catch {
    return 'America/Sao_Paulo';
  }
}

export function dentroDoExpediente(
  expediente: Expediente,
  fuso: string,
  agora: Date = new Date(),
): boolean {
  // Expediente vazio é "não configurado", e não "fechado pra sempre". Quem
  // nunca preencheu a tela atende sempre — que é como o sistema se
  // comportava antes deste recurso existir.
  if (Object.keys(expediente).length === 0) return true;

  const { dia, minutos } = agoraNaEmpresa(fusoValido(fuso), agora);
  const faixas = expediente[dia] ?? [];

  return faixas.some((faixa) => minutos >= faixa.inicio && minutos < faixa.fim);
}

/**
 * Quando a equipe volta, em palavras.
 *
 * A frase é o produto final: ela vai pro prompt da IA e pro painel, e o que
 * importa é que o cliente ouça "amanhã às 8h", não um carimbo de data.
 *
 * Procura até sete dias à frente. Empresa que só atende terça encontra a
 * terça que vem; expediente vazio não tem próxima abertura nenhuma.
 */
export function proximaAbertura(
  expediente: Expediente,
  fuso: string,
  agora: Date = new Date(),
): string | null {
  if (Object.keys(expediente).length === 0) return null;

  const hoje = agoraNaEmpresa(fusoValido(fuso), agora);

  for (let avanco = 0; avanco < 8; avanco += 1) {
    const dia = (hoje.dia + avanco) % 7;
    const faixas = expediente[dia] ?? [];

    for (const faixa of faixas) {
      // No dia de hoje só interessa o que ainda vai começar: uma faixa que
      // já passou não é a próxima abertura.
      if (avanco === 0 && faixa.inicio <= hoje.minutos) continue;

      const hora = escreverHorario(faixa.inicio);
      if (avanco === 0) return `hoje às ${hora}`;
      if (avanco === 1) return `amanhã às ${hora}`;
      return `${DIAS_DA_SEMANA[dia]} às ${hora}`;
    }
  }

  return null;
}

/**
 * O expediente do dia em uma linha ("08:00 às 12:00 e 13:00 às 18:00").
 *
 * Serve pra IA responder "que horas vocês abrem?" sem que ninguém precise
 * escrever isso numa instrução à mão — o horário já está configurado, e
 * repetir a informação em dois lugares é garantir que um dia ela vai
 * divergir.
 */
export function descreverSemana(expediente: Expediente): string[] {
  const linhas: string[] = [];

  for (let dia = 0; dia < 7; dia += 1) {
    const faixas = expediente[dia];
    if (!faixas || faixas.length === 0) continue;

    const trechos = faixas.map(
      (faixa) =>
        `${escreverHorario(faixa.inicio)} às ${escreverHorario(faixa.fim)}`,
    );
    linhas.push(`${DIAS_DA_SEMANA[dia]}: ${trechos.join(' e ')}`);
  }

  return linhas;
}

/** Quanto falta pro fim da faixa atual, em minutos. Null se estiver fechado. */
export function minutosAteFechar(
  expediente: Expediente,
  fuso: string,
  agora: Date = new Date(),
): number | null {
  if (Object.keys(expediente).length === 0) return null;

  const { dia, minutos } = agoraNaEmpresa(fusoValido(fuso), agora);
  const faixa = (expediente[dia] ?? []).find(
    (item) => minutos >= item.inicio && minutos < item.fim,
  );

  return faixa ? faixa.fim - minutos : null;
}

/**
 * Um expediente comum, pra tela não começar em branco.
 *
 * Ninguém quer preencher catorze campos pra ligar um recurso. Segunda a
 * sexta, 8h às 18h com almoço, é o que a maioria vai ajustar em vez de
 * digitar do zero — e quem atende em outro horário mexe em dois campos.
 */
export const EXPEDIENTE_PADRAO: Expediente = {
  1: [
    { inicio: 8 * 60, fim: 12 * 60 },
    { inicio: 13 * 60, fim: 18 * 60 },
  ],
  2: [
    { inicio: 8 * 60, fim: 12 * 60 },
    { inicio: 13 * 60, fim: 18 * 60 },
  ],
  3: [
    { inicio: 8 * 60, fim: 12 * 60 },
    { inicio: 13 * 60, fim: 18 * 60 },
  ],
  4: [
    { inicio: 8 * 60, fim: 12 * 60 },
    { inicio: 13 * 60, fim: 18 * 60 },
  ],
  5: [
    { inicio: 8 * 60, fim: 12 * 60 },
    { inicio: 13 * 60, fim: 18 * 60 },
  ],
};
