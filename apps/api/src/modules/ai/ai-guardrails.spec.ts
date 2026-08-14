import { verificarResposta } from './ai-guardrails';

/**
 * As travas existem por um defeito observado em produção: a IA escrevia
 * "vou te transferir" e não transferia. O cliente lia a promessa, o painel
 * marcava "aguardando cliente", e ninguém assumia.
 *
 * Testar isto é testar o momento em que uma frase vira uma ação. Os casos
 * abaixo estão escritos como o cliente e a IA realmente escrevem — com
 * acento, sem acento, caixa alta e no meio de uma frase maior — porque é
 * assim que a regra falha na prática, não com a frase de dicionário.
 */

const semFerramenta: string[] = [];

describe('promessa de passar pra um humano', () => {
  it.each([
    'Vou transferir você para o setor responsável.',
    'Já vou encaminhar seu caso.',
    'Estou transferindo agora mesmo.',
    'Um advogado vai entrar em contato com você.',
    'Nossa equipe vai analisar e responder.',
    'Aguarde um momento que já te ajudo.',
  ])('vira handoff: %s', (resposta) => {
    const verificacao = verificarResposta(
      resposta,
      'Oi, tudo bem?',
      semFerramenta,
    );
    expect(verificacao.precisaHandoff).toBe(true);
    expect(verificacao.prioridadeMinima).toBe('HIGH');
  });

  it('não dispara quando a IA de fato chamou a ferramenta', () => {
    // O ponto inteiro da trava: ela corrige a promessa NÃO cumprida. Se a
    // transferência aconteceu, escalar de novo só duplicaria o registro.
    const verificacao = verificarResposta(
      'Vou transferir você para o setor responsável.',
      'Preciso falar com alguém.',
      ['transferToQueue'],
    );
    expect(verificacao.precisaHandoff).toBe(false);
  });

  it('ignora acento, porque a IA escreve dos dois jeitos', () => {
    expect(
      verificarResposta('Seu caso será encaminhado.', 'oi', semFerramenta)
        .precisaHandoff,
    ).toBe(true);
    expect(
      verificarResposta('Seu caso sera encaminhado.', 'oi', semFerramenta)
        .precisaHandoff,
    ).toBe(true);
  });

  it('ignora caixa alta', () => {
    expect(
      verificarResposta('VOU ENCAMINHAR SEU PEDIDO', 'oi', semFerramenta)
        .precisaHandoff,
    ).toBe(true);
  });
});

describe('promessa de retorno futuro', () => {
  // A IA não roda sozinha depois nem tem agenda. Quem cumpre "te retorno"
  // é uma pessoa — então também precisa virar handoff.
  it.each([
    'Vou verificar isso e te retorno.',
    'Vou consultar o setor financeiro.',
    'Darei um retorno ainda hoje.',
    'Te aviso assim que souber.',
    'Entro em contato assim que tiver novidade.',
  ])('vira handoff: %s', (resposta) => {
    expect(
      verificarResposta(resposta, 'e aí?', semFerramenta).precisaHandoff,
    ).toBe(true);
  });

  it('não sobe a prioridade sozinha — só marca que alguém precisa assumir', () => {
    const verificacao = verificarResposta(
      'Vou verificar e te retorno.',
      'qual o prazo?',
      semFerramenta,
    );
    expect(verificacao.precisaHandoff).toBe(true);
    expect(verificacao.prioridadeMinima).toBeUndefined();
  });
});

describe('urgência relatada pelo cliente', () => {
  it.each([
    'estou preso na delegacia',
    'tenho audiência amanhã',
    'é uma emergência',
    'sofri um acidente',
    'estou no hospital',
    'recebi uma intimação',
    'o prazo vence hoje',
  ])('escala e marca como urgente: %s', (doCliente) => {
    const verificacao = verificarResposta(
      'Entendi, me conta mais.',
      doCliente,
      semFerramenta,
    );
    expect(verificacao.precisaHandoff).toBe(true);
    expect(verificacao.prioridadeMinima).toBe('URGENT');
  });

  it('urgência ganha da promessa: o motivo que aparece é o do cliente', () => {
    // Quando as duas coisas acontecem na mesma rodada, quem abre a conversa
    // precisa ler o que está em jogo, não o que a IA escreveu.
    const verificacao = verificarResposta(
      'Vou transferir você agora.',
      'estou preso, preciso de ajuda',
      semFerramenta,
    );
    expect(verificacao.prioridadeMinima).toBe('URGENT');
    expect(verificacao.motivo).toContain('urgente');
  });

  it('com a transferência já feita, ainda sobe a prioridade', () => {
    // A transferência aconteceu, então não há o que corrigir — mas um caso
    // urgente não pode entrar na fila com prioridade normal.
    const verificacao = verificarResposta(
      'Já te encaminhei para a equipe.',
      'é uma emergência',
      ['transferToQueue'],
    );
    expect(verificacao.precisaHandoff).toBe(false);
    expect(verificacao.prioridadeMinima).toBe('URGENT');
  });
});

describe('conversa comum', () => {
  it('não mexe em nada quando ninguém prometeu nem correu risco', () => {
    const verificacao = verificarResposta(
      'Nosso horário é de segunda a sexta, das 9h às 18h.',
      'vocês abrem sábado?',
      semFerramenta,
    );
    expect(verificacao).toEqual({ precisaHandoff: false });
  });

  it('não confunde "verificar" dito pelo cliente com promessa da IA', () => {
    // A lista de promessas só vale pro texto DA IA. Se ela valesse pro
    // cliente, "vou verificar com meu marido e te falo" escalaria sozinho.
    const verificacao = verificarResposta(
      'Claro, fico à disposição.',
      'vou verificar com meu marido e te falo',
      semFerramenta,
    );
    expect(verificacao.precisaHandoff).toBe(false);
  });
});
