import {
  ORCAMENTO_DE_CONHECIMENTO,
  agoraNoFuso,
  cabemNoOrcamento,
  descreverMensagem,
  encurtar,
  juntarTurnosSeguidos,
  mereceBuscaNaBase,
} from './ai-context';

/**
 * Estas funções decidem duas coisas ao mesmo tempo: quanto se paga por
 * resposta e o que a IA consegue entender.
 *
 * Errar pra economizar é o risco real — um corte agressivo demais tira o
 * contexto que o cliente precisava e a resposta vira "não entendi". Por
 * isso quase todo teste aqui guarda os DOIS lados: o que tem que ser
 * descartado e o que nunca pode ser.
 */

describe('quando vale buscar na base de conhecimento', () => {
  it.each([
    'qual o horário de vocês?',
    'quanto custa',
    'preciso de uma segunda via',
    'vocês atendem em Vitória?',
    'como faço pra cancelar',
  ])('pergunta de verdade busca: %s', (texto) => {
    expect(mereceBuscaNaBase(texto)).toBe(true);
  });

  it.each([
    'oi',
    'Olá',
    'bom dia',
    'Boa noite!',
    'ok',
    'obrigado',
    'obrigada.',
    'valeu',
    'blz',
    'entendi',
    'perfeito',
    'sim',
    'combinado',
  ])('cortesia não busca: %s', (texto) => {
    // Cada uma dessas custaria uma chamada de embedding e até quatro mil
    // caracteres de prompt pra devolver trecho de contrato que não
    // responde "bom dia".
    expect(mereceBuscaNaBase(texto)).toBe(false);
  });

  it('emoji e pontuação sozinhos não buscam', () => {
    expect(mereceBuscaNaBase('👍')).toBe(false);
    expect(mereceBuscaNaBase('!!!')).toBe(false);
    expect(mereceBuscaNaBase('...')).toBe(false);
  });

  it('mensagem vazia não busca', () => {
    expect(mereceBuscaNaBase('')).toBe(false);
    expect(mereceBuscaNaBase('   ')).toBe(false);
  });

  it('pergunta curta de duas palavras AINDA busca', () => {
    // É a mais importante que existe, e cortá-la por ser curta seria o
    // erro caro: a resposta sairia sem a tabela de preço.
    expect(mereceBuscaNaBase('quanto custa')).toBe(true);
    expect(mereceBuscaNaBase('tem desconto?')).toBe(true);
  });

  it('cortesia seguida de pergunta busca — o que importa é o resto', () => {
    expect(mereceBuscaNaBase('oi, queria saber o preço')).toBe(true);
    expect(mereceBuscaNaBase('bom dia! vocês abrem sábado?')).toBe(true);
  });
});

describe('anexo visto pela IA', () => {
  it('imagem sem legenda vira um marcador, não um turno vazio', () => {
    // Antes chegava como conteúdo vazio: da perspectiva do modelo o
    // cliente não tinha dito nada, e ele respondia ao assunto anterior ou
    // pedia pra repetir o que a pessoa acabara de mandar.
    expect(
      descreverMensagem({
        content: '',
        messageType: 'IMAGE',
        senderType: 'CUSTOMER',
      }),
    ).toBe('[O cliente enviou uma imagem, que você não consegue abrir]');
  });

  it('a legenda continua sendo o que importa', () => {
    const texto = descreverMensagem({
      content: 'esse é o comprovante',
      messageType: 'IMAGE',
      senderType: 'CUSTOMER',
    });
    expect(texto).toContain('esse é o comprovante');
    expect(texto).toContain('imagem');
  });

  it('diz que não consegue abrir — porque não consegue mesmo', () => {
    // O binário não vai pro provedor. Sem essa ressalva a IA responde como
    // se tivesse lido o documento, e inventa o que estava nele.
    expect(
      descreverMensagem({
        content: '',
        messageType: 'DOCUMENT',
        senderType: 'CUSTOMER',
      }),
    ).toContain('não consegue abrir');
  });

  it('sabe de que lado veio o anexo', () => {
    expect(
      descreverMensagem({
        content: '',
        messageType: 'AUDIO',
        senderType: 'AGENT',
      }),
    ).toContain('A empresa enviou');
  });

  it('texto comum passa intacto', () => {
    expect(
      descreverMensagem({
        content: 'Oi, tudo bem?',
        messageType: 'TEXT',
        senderType: 'CUSTOMER',
      }),
    ).toBe('Oi, tudo bem?');
  });
});

describe('falas seguidas do mesmo lado', () => {
  it('viram um turno só', () => {
    // No WhatsApp ninguém escreve parágrafo: escreve três mensagens.
    const juntas = juntarTurnosSeguidos([
      { role: 'user', content: 'oi' },
      { role: 'user', content: 'tudo bem?' },
      { role: 'user', content: 'queria saber o preço' },
    ]);

    expect(juntas).toEqual([
      { role: 'user', content: 'oi\ntudo bem?\nqueria saber o preço' },
    ]);
  });

  it('alternância de verdade não é mexida', () => {
    const original = [
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'olá!' },
      { role: 'user', content: 'quanto custa?' },
    ];
    expect(juntarTurnosSeguidos(original)).toEqual(original);
  });

  it('junta dos dois lados', () => {
    const juntas = juntarTurnosSeguidos([
      { role: 'assistant', content: 'Oi!' },
      { role: 'assistant', content: 'Posso ajudar?' },
      { role: 'user', content: 'pode' },
    ]);

    expect(juntas).toHaveLength(2);
    expect(juntas[0].content).toBe('Oi!\nPosso ajudar?');
  });

  it('lista vazia continua vazia', () => {
    expect(juntarTurnosSeguidos([])).toEqual([]);
  });
});

describe('corte de texto longo', () => {
  it('texto dentro do limite passa intacto', () => {
    expect(encurtar('mensagem curta', 100)).toBe('mensagem curta');
  });

  it('corta na palavra inteira e avisa que cortou', () => {
    // Sem as reticências o modelo lê o trecho como a mensagem completa e
    // responde a uma frase que o cliente não terminou.
    const cortado = encurtar('palavra '.repeat(50), 40);
    expect(cortado.length).toBeLessThanOrEqual(41);
    expect(cortado.endsWith('…')).toBe(true);
    expect(cortado).not.toContain('palav…');
  });

  it('texto sem espaço nenhum ainda é cortado', () => {
    const cortado = encurtar('x'.repeat(500), 40);
    expect(cortado).toHaveLength(41);
  });
});

describe('orçamento dos trechos de conhecimento', () => {
  const trecho = (id: string, tamanho: number) => ({
    content: `${id}${'x'.repeat(tamanho)}`,
    documentTitle: 'Doc',
  });

  it('leva todos quando cabem', () => {
    const trechos = [trecho('a', 100), trecho('b', 100), trecho('c', 100)];
    expect(cabemNoOrcamento(trechos)).toHaveLength(3);
  });

  it('corta do fim, que é o menos parecido com a pergunta', () => {
    const trechos = [
      trecho('a', 1500),
      trecho('b', 1500),
      trecho('c', 1500),
      trecho('d', 1500),
    ];
    const escolhidos = cabemNoOrcamento(trechos);

    expect(escolhidos.length).toBeLessThan(4);
    expect(escolhidos[0].content.startsWith('a')).toBe(true);
  });

  it('respeita o teto somado', () => {
    const trechos = Array.from({ length: 10 }, (_, i) =>
      trecho(String(i), 1000),
    );
    const gasto = cabemNoOrcamento(trechos).reduce(
      (s, t) => s + t.content.length,
      0,
    );

    expect(gasto).toBeLessThanOrEqual(ORCAMENTO_DE_CONHECIMENTO + 1001);
  });

  it('o primeiro entra mesmo estourando sozinho', () => {
    // Devolver zero trecho por causa de um documento de parágrafos longos
    // seria pior que devolver um: a IA responderia sem a base.
    const gigante = [trecho('unico', ORCAMENTO_DE_CONHECIMENTO * 2)];
    expect(cabemNoOrcamento(gigante)).toHaveLength(1);
  });

  it('não paga duas vezes pelo mesmo texto', () => {
    // A sobreposição entre pedaços faz o mesmo trecho voltar em documentos
    // diferentes.
    const repetido = {
      content: 'mesmo conteúdo repetido aqui',
      documentTitle: 'A',
    };
    const escolhidos = cabemNoOrcamento([
      repetido,
      { ...repetido, documentTitle: 'B' },
      trecho('outro', 50),
    ]);

    expect(escolhidos).toHaveLength(2);
  });

  it('nenhum trecho não vira erro', () => {
    expect(cabemNoOrcamento([])).toEqual([]);
  });
});

describe('data e hora no fuso da empresa', () => {
  const momento = new Date('2026-08-14T02:30:00Z');

  it('usa o fuso da empresa, não o do servidor', () => {
    // O Railway roda em UTC. Às 02:30 UTC já é dia 14 lá e ainda é dia 13
    // em São Paulo — três horas que mudam o dia inteiro da resposta.
    const emSaoPaulo = agoraNoFuso('America/Sao_Paulo', momento);
    expect(emSaoPaulo).toContain('13 de agosto');
    expect(emSaoPaulo).toContain('quinta');
  });

  it('respeita outro fuso configurado', () => {
    expect(agoraNoFuso('America/Manaus', momento)).toContain('13 de agosto');
    expect(agoraNoFuso('UTC', momento)).toContain('14 de agosto');
  });

  it('fuso inválido no cadastro não derruba a resposta ao cliente', () => {
    expect(() =>
      agoraNoFuso('Continente/Cidade_Que_Nao_Existe', momento),
    ).not.toThrow();
    expect(agoraNoFuso('Continente/Cidade_Que_Nao_Existe', momento)).toContain(
      'agosto',
    );
  });
});
