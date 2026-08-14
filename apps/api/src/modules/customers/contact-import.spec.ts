import { normalizePhone, parseContactsCsv } from './contact-import';

/**
 * A planilha do escritório.
 *
 * Ela nunca vem no formato que o sistema queria: sai do Excel em português
 * (ponto-e-vírgula), com telefone formatado à mão, cabeçalho escrito como
 * a pessoa achou melhor, e linha repetida. Exigir um formato exato faria a
 * empresa editar a planilha antes de importar — e aí ninguém importa.
 *
 * O que NÃO pode acontecer é descartar contato em silêncio: cada linha
 * recusada volta pra tela com o motivo.
 */

describe('normalizePhone', () => {
  it('limpa a formatação que vem da planilha', () => {
    expect(normalizePhone('(27) 99999-8888')).toBe('5527999998888');
    expect(normalizePhone('+55 27 99999-8888')).toBe('5527999998888');
    expect(normalizePhone('27999998888')).toBe('5527999998888');
  });

  it('põe o 55 em número nacional e respeita quem já tem', () => {
    expect(normalizePhone('2733334444')).toBe('552733334444');
    expect(normalizePhone('5527999998888')).toBe('5527999998888');
  });

  it('recusa o que não é telefone', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('não informado')).toBeNull();
    expect(normalizePhone('55279999988881234')).toBeNull();
  });
});

describe('parseContactsCsv', () => {
  it('lê o cabeçalho por apelido, não por nome exato', () => {
    const { contacts } = parseContactsCsv(
      'Nome;Celular\nAna Souza;(27) 99999-8888',
    );

    expect(contacts).toEqual([{ name: 'Ana Souza', phone: '5527999998888' }]);
  });

  it('aceita ponto-e-vírgula, que é o padrão do Excel em português', () => {
    const { contacts } = parseContactsCsv('nome;telefone\nAna;27999998888');
    expect(contacts).toHaveLength(1);
  });

  it('aceita vírgula também', () => {
    const { contacts } = parseContactsCsv('nome,telefone\nAna,27999998888');
    expect(contacts).toHaveLength(1);
  });

  it('sem cabeçalho reconhecível, assume nome e telefone nas duas primeiras colunas', () => {
    const { contacts } = parseContactsCsv('Ana Souza,27999998888');
    expect(contacts).toEqual([{ name: 'Ana Souza', phone: '5527999998888' }]);
  });

  it('cabeçalho reconhecido mas sem coluna de telefone não rejeita a planilha inteira', () => {
    // O defeito: "Nome;Celular do responsável" fazia o reconhecimento
    // achar o nome e não achar o telefone, e o relatório dizia que TODA
    // linha estava sem telefone — quando o errado era o reconhecimento.
    const { contacts, rejected } = parseContactsCsv(
      'Nome;Celular do responsável\nAna Souza;27999998888',
    );

    expect(rejected).toEqual([]);
    expect(contacts).toEqual([{ name: 'Ana Souza', phone: '5527999998888' }]);
  });

  it('ignora acento e caixa no cabeçalho', () => {
    const { contacts } = parseContactsCsv('NOME;TELEFONE\nAna;27999998888');
    expect(contacts).toHaveLength(1);
  });

  it('lê e-mail quando a coluna existe', () => {
    const { contacts } = parseContactsCsv(
      'nome,telefone,email\nAna,27999998888,ana@exemplo.com',
    );
    expect(contacts[0]).toEqual({
      name: 'Ana',
      phone: '5527999998888',
      email: 'ana@exemplo.com',
    });
  });

  it('sem nome, o telefone serve de rótulo até o cliente escrever', () => {
    const { contacts } = parseContactsCsv('nome,telefone\n,27999998888');
    expect(contacts[0].name).toBe('5527999998888');
  });

  it('devolve a linha e o motivo de cada recusa, em vez de descartar calado', () => {
    const { contacts, rejected } = parseContactsCsv(
      'nome,telefone\nAna,27999998888\nBruno,não tem\nCarla,',
    );

    expect(contacts).toHaveLength(1);
    expect(rejected).toEqual([
      { line: 3, reason: 'Telefone inválido: não tem' },
      { line: 4, reason: 'Sem telefone' },
    ]);
  });

  it('recusa a repetição dentro da própria planilha', () => {
    const { contacts, rejected } = parseContactsCsv(
      'nome,telefone\nAna,27999998888\nAna Souza,(27) 99999-8888',
    );

    expect(contacts).toHaveLength(1);
    expect(rejected[0].reason).toContain('Repetido');
  });

  it('respeita aspas — nome com vírgula dentro não vira duas colunas', () => {
    const { contacts } = parseContactsCsv(
      'nome,telefone\n"Souza, Ana",27999998888',
    );
    expect(contacts[0].name).toBe('Souza, Ana');
  });

  it('aspas duplas dentro do campo viram uma aspa literal', () => {
    const { contacts } = parseContactsCsv(
      'nome,telefone\n"Ana ""Aninha"" Souza",27999998888',
    );
    expect(contacts[0].name).toBe('Ana "Aninha" Souza');
  });

  it('pula linha em branco no meio do arquivo', () => {
    const { contacts, rejected } = parseContactsCsv(
      'nome,telefone\nAna,27999998888\n\n\nBruno,27888887777',
    );

    expect(contacts).toHaveLength(2);
    expect(rejected).toEqual([]);
  });

  it('arquivo vazio não é erro, só não importa nada', () => {
    expect(parseContactsCsv('')).toEqual({ contacts: [], rejected: [] });
    expect(parseContactsCsv('\n\n  \n')).toEqual({
      contacts: [],
      rejected: [],
    });
  });

  it('aceita quebra de linha do Windows', () => {
    const { contacts } = parseContactsCsv(
      'nome,telefone\r\nAna,27999998888\r\n',
    );
    expect(contacts).toHaveLength(1);
  });
});
