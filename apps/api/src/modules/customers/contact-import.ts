export interface ParsedContact {
  name: string;
  phone: string;
  email?: string;
}

export interface ImportReport {
  contacts: ParsedContact[];
  /** Linha e motivo — devolvido pra tela em vez de descartado em silêncio. */
  rejected: { line: number; reason: string }[];
}

/**
 * Só dígitos, e com o 55 na frente. A Cloud API não aceita telefone
 * formatado, e planilha de empresa vem de tudo quanto é jeito:
 * "(27) 99999-8888", "+55 27 99999-8888", "27999998888".
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  // 10 ou 11 dígitos = número nacional sem DDI; 12 ou 13 já vem com o 55.
  if (digits.length <= 11) return `55${digits}`;
  if (digits.length <= 13) return digits;
  return null;
}

function splitLine(line: string): string[] {
  // Aceita vírgula e ponto-e-vírgula porque o Excel em português exporta
  // com ponto-e-vírgula por padrão — e é dele que essas planilhas saem.
  const separator = line.includes(';') && !line.includes(',') ? ';' : ',';
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      // Aspas duplas dentro de campo entre aspas viram uma aspa literal.
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === separator && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

const HEADER_ALIASES: Record<string, 'name' | 'phone' | 'email'> = {
  nome: 'name',
  name: 'name',
  cliente: 'name',
  contato: 'name',
  telefone: 'phone',
  celular: 'phone',
  whatsapp: 'phone',
  fone: 'phone',
  phone: 'phone',
  numero: 'phone',
  'e-mail': 'email',
  email: 'email',
};

function normalizeHeader(cell: string) {
  return cell
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Lê CSV de contatos. O cabeçalho é reconhecido por apelido (nome,
 * telefone, celular, whatsapp...) porque exigir um formato exato faria a
 * empresa editar a planilha antes de importar — e aí ninguém importa.
 * Sem cabeçalho reconhecível, assume nome na primeira coluna e telefone na
 * segunda, que é o arranjo mais comum.
 */
export function parseContactsCsv(content: string): ImportReport {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { contacts: [], rejected: [] };
  }

  const header = splitLine(lines[0]).map(normalizeHeader);
  const mapped = header.map((cell) => HEADER_ALIASES[cell]);
  const hasHeader = mapped.some((field) => field !== undefined);

  const nameAt = hasHeader ? mapped.indexOf('name') : 0;
  const phoneAt = hasHeader ? mapped.indexOf('phone') : 1;
  const emailAt = hasHeader ? mapped.indexOf('email') : -1;

  const contacts: ParsedContact[] = [];
  const rejected: ImportReport['rejected'] = [];
  const seen = new Set<string>();

  for (let index = hasHeader ? 1 : 0; index < lines.length; index++) {
    const cells = splitLine(lines[index]);
    const rawPhone = phoneAt >= 0 ? (cells[phoneAt] ?? '') : '';
    const phone = normalizePhone(rawPhone);

    if (!phone) {
      rejected.push({
        line: index + 1,
        reason: rawPhone ? `Telefone inválido: ${rawPhone}` : 'Sem telefone',
      });
      continue;
    }
    if (seen.has(phone)) {
      rejected.push({ line: index + 1, reason: `Repetido na planilha: ${phone}` });
      continue;
    }
    seen.add(phone);

    const name = (nameAt >= 0 ? cells[nameAt] : '')?.trim();
    const email = emailAt >= 0 ? cells[emailAt]?.trim() : undefined;

    contacts.push({
      // Sem nome, o telefone serve de rótulo até o cliente escrever — é
      // melhor que "Sem nome" repetido na lista inteira.
      name: name || phone,
      phone,
      ...(email ? { email } : {}),
    });
  }

  return { contacts, rejected };
}
