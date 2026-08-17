import { porQueAIaNaoRespondeu } from './ai-indisponivel';

/**
 * Nem toda falha da IA é a mesma falha, e a diferença é acionável.
 *
 * A frase daqui aparece em "por que veio pra equipe", que é a primeira
 * coisa que o atendente lê ao abrir a conversa — e, quando o dono olha,
 * é o que decide se o caminho é comprar mais cota, arrumar uma chave ou
 * esperar o provedor voltar. Um "não houve resposta automática" para os
 * três casos obrigava a abrir o log do servidor, que quem atende quase
 * nunca tem.
 */

describe('limite de uso estourado', () => {
  it.each([
    new Error('429 Too Many Requests'),
    new Error('RESOURCE_EXHAUSTED: quota exceeded for model'),
    new Error('You exceeded your current quota, please check your plan'),
    new Error('Rate limit reached for gemini-2.5-flash'),
  ])('reconhece: %s', (erro) => {
    expect(porQueAIaNaoRespondeu(erro).motivo).toContain('limite de uso');
  });

  it('reconhece o nome do erro, e não só a mensagem', () => {
    // O SDK do Google às vezes põe a classificação no `name` e deixa a
    // mensagem genérica.
    const erro = new Error('a chamada falhou');
    erro.name = 'ResourceExhausted';

    expect(porQueAIaNaoRespondeu(erro).motivo).toContain('limite de uso');
  });
});

describe('as outras causas', () => {
  it('chave recusada aponta pra configuração, não pra cota', () => {
    expect(
      porQueAIaNaoRespondeu(new Error('API key not valid. Please pass a valid API key.')).motivo,
    ).toContain('chave de acesso');
  });

  it('provedor mudo é demora, e não erro de conta', () => {
    expect(
      porQueAIaNaoRespondeu(
        new Error('O provedor de IA não respondeu em 25 segundos (gerar a resposta).'),
      ).motivo,
    ).toContain('demorou demais');
  });

  it('o que não se reconhece cai no genérico, sem inventar diagnóstico', () => {
    // Chutar "acabou a cota" numa falha desconhecida mandaria o dono
    // comprar um plano pra resolver um problema que era outro.
    expect(porQueAIaNaoRespondeu(new Error('algo estranho')).motivo).toBe(
      'O cliente escreveu e não houve resposta automática.',
    );
  });

  it('não quebra com o que não é erro', () => {
    expect(() => porQueAIaNaoRespondeu(undefined)).not.toThrow();
    expect(() => porQueAIaNaoRespondeu({ estranho: true })).not.toThrow();
  });
});

describe('a frase não é um boletim de incidente', () => {
  it.each([
    new Error('429 quota'),
    new Error('API key not valid'),
    new Error('timeout'),
  ])('descreve o caso, não o defeito: %s', (erro) => {
    const { motivo } = porQueAIaNaoRespondeu(erro);

    // Quem lê está prestes a atender um cliente. "Erro 429 no provedor" na
    // abertura da conversa não ajuda a atender, e numa demonstração
    // deprecia o produto sem necessidade.
    expect(motivo).toMatch(/cliente está esperando/);
    expect(motivo).not.toMatch(/\b(429|401|403|erro|falha|exception)\b/i);
  });
});
