import {
  desempacotarId,
  empacotarId,
  jidDoTelefone,
  telefoneDoJid,
} from './evolution-id';
import { motivoDaEvolution } from './evolution.client';
import {
  chaveDoEvento,
  comoLista,
  horaDaMensagem,
  traduzirMensagem,
  traduzirStatus,
} from './evolution-mensagem';

/**
 * Estes testes existem porque o webhook da Evolution é a peça mais
 * instável do sistema.
 *
 * Ela é software livre em movimento: a forma do evento já mudou entre
 * versões maiores, e vai mudar de novo. Sem um teste que fixe o formato
 * esperado, a única forma de descobrir que a tradução quebrou é o cliente
 * escrevendo e ninguém vendo a mensagem — que é exatamente o defeito que
 * não aparece em log nenhum.
 */

describe('id composto', () => {
  it('sobrevive à ida e à volta', () => {
    const chave = {
      remoteJid: '5511999999999@s.whatsapp.net',
      fromMe: true,
      id: '3EB0ABC',
    };

    expect(desempacotarId(empacotarId(chave))).toEqual(chave);
  });

  it('devolve nulo pra id de outro provedor em vez de quebrar', () => {
    // O banco tem wamid da Meta em linhas antigas. Uma empresa que migrou
    // abriria conversa e derrubaria a requisição se isto lançasse.
    expect(desempacotarId('wamid.HBgNNTUxMQ==')).toBeNull();
  });

  it('limpa o telefone antes de montar o JID', () => {
    expect(jidDoTelefone('+55 (11) 99999-9999')).toBe(
      '5511999999999@s.whatsapp.net',
    );
  });

  it('recusa grupo, que não é atendimento individual', () => {
    // Sem isto, um grupo viraria um "cliente" com o id do grupo, e o que
    // várias pessoas escreveram cairia numa conversa só.
    expect(telefoneDoJid('120363000000000000@g.us')).toBeNull();
    expect(telefoneDoJid('status@broadcast')).toBeNull();
  });

  it('tira o sufixo de aparelho do JID', () => {
    expect(telefoneDoJid('5511999999999:12@s.whatsapp.net')).toBe(
      '5511999999999',
    );
  });
});

describe('tradução da mensagem', () => {
  it('lê o texto simples', () => {
    expect(
      traduzirMensagem({ message: { conversation: 'bom dia' } }),
    ).toMatchObject({ content: 'bom dia', messageType: 'TEXT' });
  });

  it('acha a citação na raiz, que é onde a Evolution a deixa', () => {
    // Ela reescreve `extendedTextMessage` como `conversation` antes de
    // mandar, e o contexto sobe pra raiz do evento. Procurar só dentro da
    // mensagem perde TODA resposta a mensagem anterior.
    expect(
      traduzirMensagem({
        message: { conversation: 'é sobre isso' },
        contextInfo: { stanzaId: '3EB0ANTERIOR' },
      }),
    ).toMatchObject({ content: 'é sobre isso', citando: '3EB0ANTERIOR' });
  });

  it('lê o texto que veio citando outra mensagem', () => {
    const traduzida = traduzirMensagem({
      message: {
        extendedTextMessage: {
          text: 'é sobre isso',
          contextInfo: { stanzaId: '3EB0ANTERIOR' },
        },
      },
    });

    expect(traduzida).toMatchObject({
      content: 'é sobre isso',
      messageType: 'TEXT',
      citando: '3EB0ANTERIOR',
    });
  });

  it('enxerga o texto dentro do embrulho de mensagem temporária', () => {
    // O caso que some sem erro: com mensagens temporárias ligadas na
    // conversa, TODO o conteúdo vem embrulhado, e sem desembrulhar a
    // mensagem do cliente simplesmente não aparece no painel.
    expect(
      traduzirMensagem({
        message: { ephemeralMessage: { message: { conversation: 'oi' } } },
      }),
    ).toMatchObject({ content: 'oi', messageType: 'TEXT' });
  });

  it('usa a legenda da imagem como texto da mensagem', () => {
    expect(
      traduzirMensagem({
        message: {
          imageMessage: { mimetype: 'image/jpeg', caption: 'chegou assim' },
        },
      }),
    ).toMatchObject({ content: 'chegou assim', messageType: 'IMAGE' });
  });

  it('cai no nome do arquivo quando o documento não tem legenda', () => {
    expect(
      traduzirMensagem({
        message: {
          documentMessage: {
            mimetype: 'application/pdf',
            fileName: 'nota-fiscal.pdf',
          },
        },
      }),
    ).toMatchObject({ content: 'nota-fiscal.pdf', messageType: 'DOCUMENT' });
  });

  it('separa o áudio gravado na hora do arquivo de música', () => {
    const gravado = traduzirMensagem({
      message: { audioMessage: { mimetype: 'audio/ogg', ptt: true } },
    });

    expect(gravado?.metadata).toMatchObject({ voice: true });
  });

  it('lê a localização', () => {
    expect(
      traduzirMensagem({
        message: {
          locationMessage: {
            degreesLatitude: -23.5,
            degreesLongitude: -46.6,
            name: 'Loja centro',
          },
        },
      }),
    ).toMatchObject({ content: 'Loja centro', messageType: 'LOCATION' });
  });

  it('devolve nulo pro que não sabe traduzir', () => {
    // Melhor não gravar nada que gravar um balão vazio: o atendente veria
    // uma mensagem em branco e não teria como saber que chegou algo.
    expect(traduzirMensagem({ message: { pollCreationMessage: {} } })).toBeNull();
    expect(traduzirMensagem({ message: null })).toBeNull();
  });
});

describe('chave do evento', () => {
  it('lê a chave aninhada de messages.upsert', () => {
    expect(
      chaveDoEvento({
        key: { remoteJid: '5511999@s.whatsapp.net', fromMe: false, id: '3EB0' },
      }),
    ).toEqual({ remoteJid: '5511999@s.whatsapp.net', fromMe: false, id: '3EB0' });
  });

  it('lê a chave achatada de messages.update', () => {
    // O formato é outro no mesmo webhook: aqui vêm `keyId`, `remoteJid` e
    // `fromMe` soltos na raiz. Sem isto, o envio funciona e o tique de
    // entregue nunca vira — falha que não aparece em log nenhum.
    expect(
      chaveDoEvento({
        keyId: '3EB0',
        remoteJid: '5511999@s.whatsapp.net',
        fromMe: true,
        status: 'DELIVERY_ACK',
      }),
    ).toEqual({ remoteJid: '5511999@s.whatsapp.net', fromMe: true, id: '3EB0' });
  });

  it('troca o identificador opaco pelo JID de verdade', () => {
    // O WhatsApp passou a esconder o telefone atrás de `@lid` em algumas
    // conversas. Sem olhar o campo ao lado, essas mensagens seriam
    // descartadas como se fossem de grupo.
    expect(
      chaveDoEvento({
        key: {
          remoteJid: '123456@lid',
          remoteJidAlt: '5511999@s.whatsapp.net',
          fromMe: false,
          id: '3EB0',
        },
      }),
    ).toMatchObject({ remoteJid: '5511999@s.whatsapp.net' });
  });

  it('devolve nulo quando falta id ou conversa', () => {
    expect(chaveDoEvento({ remoteJid: '5511999@s.whatsapp.net' })).toBeNull();
    expect(chaveDoEvento({ keyId: '3EB0' })).toBeNull();
  });
});

describe('status de entrega', () => {
  it('traduz o vocabulário do protocolo', () => {
    expect(traduzirStatus('SERVER_ACK')).toBe('SENT');
    expect(traduzirStatus('DELIVERY_ACK')).toBe('DELIVERED');
    expect(traduzirStatus('READ')).toBe('READ');
    // Áudio ouvido também é lido: mostrar dois tiques cinzas em quem já
    // ouviu o recado seria mentira na tela.
    expect(traduzirStatus('PLAYED')).toBe('READ');
  });

  it('ignora o que não conhece em vez de inventar', () => {
    expect(traduzirStatus('ALGO_NOVO')).toBeNull();
    expect(traduzirStatus(undefined)).toBeNull();
  });
});

describe('hora da mensagem', () => {
  it('usa a hora em que o cliente escreveu', () => {
    // Importa na volta de uma queda: a sessão devolve o acumulado de uma
    // vez, e sem isto a espera de quem escreveu de manhã apareceria como
    // zero minuto.
    expect(horaDaMensagem({ messageTimestamp: 1755300000 })).toEqual(
      new Date(1755300000 * 1000),
    );
  });

  it('devolve indefinido quando não veio hora, pra valer agora', () => {
    expect(horaDaMensagem({})).toBeUndefined();
  });
});

describe('formato do lote', () => {
  it('aceita uma mensagem só ou uma lista', () => {
    expect(comoLista({ key: { id: 'a' } })).toHaveLength(1);
    expect(comoLista([{ key: { id: 'a' } }, { key: { id: 'b' } }])).toHaveLength(2);
    expect(comoLista(undefined)).toEqual([]);
  });
});

describe('motivo da recusa', () => {
  it('acha o texto nos três formatos que a Evolution usa', () => {
    expect(motivoDaEvolution('{"message":"number not exists"}', 400)).toBe(
      'number not exists',
    );
    expect(motivoDaEvolution('{"error":"instance not found"}', 400)).toBe(
      'instance not found',
    );
    expect(
      motivoDaEvolution('{"response":{"message":["number is required"]}}', 400),
    ).toBe('number is required');
  });

  it('a lista de objetos não vira "[object Object]"', () => {
    // Foi o que apareceu no log no lugar do motivo de uma sessão não ter
    // sido apagada — e mandou quem investigava procurar no lugar errado.
    const motivo = motivoDaEvolution(
      '{"response":{"message":[{"instance":"não pode ser apagada"}]}}',
      400,
    );
    expect(motivo).not.toContain('[object Object]');
    expect(motivo).toContain('não pode ser apagada');
  });

  it('explica o 401 em vez de mostrar o código', () => {
    expect(motivoDaEvolution('não é json', 401)).toContain('chave da API');
  });

  it('explica o 404 como sessão perdida', () => {
    // É o erro que aparece quando o servidor foi recriado do zero: a
    // empresa precisa ler o QR code de novo, e "HTTP 404" não diz isso.
    expect(motivoDaEvolution('', 404)).toContain('sessão não existe');
  });
});

describe('estado de entrega em número (o defeito do tique)', () => {
  /**
   * O relato: envio funcionando, cliente recebendo, e o balão parado no
   * relógio pra sempre. A causa não era a busca nem o tipo desconhecido —
   * era `.toUpperCase()` num número, que derrubava o webhook com
   * TypeError. Toda entrega de `messages.update` voltava 500, a Evolution
   * reenviava, e nenhum tique jamais virava.
   *
   * O número vem do Baileys, onde o estado é enum numérico na origem.
   */
  it.each([
    [0, 'FAILED'],
    [1, 'PENDING'],
    [2, 'SENT'],
    [3, 'DELIVERED'],
    [4, 'READ'],
    [5, 'READ'],
  ])('traduz o código %s', (bruto, esperado) => {
    expect(traduzirStatus(bruto)).toBe(esperado);
  });

  it('aceita o número que atravessou o JSON como texto', () => {
    expect(traduzirStatus('3')).toBe('DELIVERED');
  });

  it('continua entendendo o nome', () => {
    expect(traduzirStatus('DELIVERY_ACK')).toBe('DELIVERED');
    expect(traduzirStatus('read')).toBe('READ');
  });

  it('não inventa estado pro que não conhece', () => {
    expect(traduzirStatus('ALGO_NOVO')).toBeNull();
    expect(traduzirStatus(99)).toBeNull();
    expect(traduzirStatus(undefined)).toBeNull();
    expect(traduzirStatus('')).toBeNull();
  });
});
