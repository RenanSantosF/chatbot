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

describe('anúncio de encerramento', () => {
  /**
   * O relato: o cliente disse "Ok", a IA respondeu "Atendimento encerrado
   * por aqui" e a conversa continuou marcada como "aguardando cliente".
   * Quem lia o painel e quem lia o WhatsApp viam coisas diferentes sobre o
   * fato mais básico do atendimento — se ele acabou.
   */
  it.each([
    'Atendimento encerrado por aqui. Se precisar, é só mandar mensagem.',
    'Estou encerrando o atendimento. Obrigada pelo contato!',
    'Vou encerrar por aqui então. Tenha um bom dia!',
    'Seu atendimento foi finalizado.',
  ])('manda encerrar de verdade: %s', (resposta) => {
    const verificacao = verificarResposta(resposta, 'Ok', semFerramenta);

    expect(verificacao.encerrar).toBe(true);
    expect(verificacao.precisaHandoff).toBe(false);
  });

  it('não encerra uma despedida comum', () => {
    // "Fico à disposição" não é encerramento — se fosse, toda conversa
    // educada sairia da fila.
    const verificacao = verificarResposta(
      'De nada! Fico à disposição se precisar de mais alguma coisa.',
      'Obrigado',
      semFerramenta,
    );

    expect(verificacao.encerrar).toBeFalsy();
  });

  it('promessa de humano ganha do encerramento', () => {
    // Encerrar aqui tiraria da fila justamente o caso que alguém precisa
    // pegar — e o cliente já foi avisado de que alguém vem.
    const verificacao = verificarResposta(
      'Vou transferir você para o setor jurídico e encerro meu atendimento por aqui.',
      'Quero falar com um advogado',
      semFerramenta,
    );

    expect(verificacao.precisaHandoff).toBe(true);
    expect(verificacao.encerrar).toBeFalsy();
  });
});

describe('dado inventado', () => {
  const SEM_BASE = 'Você é a assistente do escritório. Atendemos das 08h às 17h.';

  it('barra o endereço que não está em lugar nenhum — o caso relatado', () => {
    const verificacao = verificarResposta(
      'O nosso escritório fica na Avenida Paulista, nº 1000, Bela Vista - São Paulo/SP.',
      'Onde fica o escritório?',
      semFerramenta,
      SEM_BASE,
    );

    expect(verificacao.substituirPor).toBeTruthy();
    expect(verificacao.substituirPor).not.toContain('Paulista');
    // Barrar sem chamar ninguém deixaria o cliente sem resposta nenhuma.
    expect(verificacao.precisaHandoff).toBe(true);
  });

  it('deixa passar o endereço que está na base', () => {
    const verificacao = verificarResposta(
      'Ficamos na Rua Sete de Setembro, 250, Centro, Vitória.',
      'Onde fica o escritório?',
      semFerramenta,
      '[Base] Endereço: Rua Sete de Setembro, 250 — Centro, Vitória/ES.',
    );

    expect(verificacao.substituirPor).toBeUndefined();
  });

  it('sem fontes informadas, não inventa alarme', () => {
    // Chamadas antigas passam três argumentos. Sem material de referência
    // não dá pra afirmar que algo foi inventado — e barrar tudo seria pior
    // que não barrar nada.
    const verificacao = verificarResposta(
      'Claro! Como posso te ajudar?',
      'oi',
      semFerramenta,
    );

    expect(verificacao.substituirPor).toBeUndefined();
  });
});
