import {
  desempacotarId,
  empacotarId,
  idDaMensagem,
  jidDoTelefone,
  normalizarJid,
  telefoneDoJid,
} from './evolution-id';

/**
 * O id externo é comparado por IGUALDADE EXATA quando um evento de
 * entrega chega. Isso torna a forma de escrevê-lo parte do funcionamento,
 * não detalhe estético: uma diferença de um caractere entre a gravação e o
 * evento é um tique que nunca vira, com o envio funcionando o tempo todo.
 */

const TELEFONE = '5527999998888';
const JID = `${TELEFONE}@s.whatsapp.net`;

describe('a mesma conversa escrita de formas diferentes', () => {
  it.each([
    JID,
    // O sufixo de aparelho vem quando a mensagem é atribuída a um
    // dispositivo vinculado específico.
    `${TELEFONE}:12@s.whatsapp.net`,
    `  ${JID}  `,
  ])('vira sempre a mesma chave: %s', (variante) => {
    expect(empacotarId({ remoteJid: variante, fromMe: true, id: 'ABC' })).toBe(
      empacotarId({ remoteJid: JID, fromMe: true, id: 'ABC' }),
    );
  });

  it('o envio e o evento de entrega passam a bater', () => {
    // Este é o defeito exato: a resposta do envio traz o JID limpo, e o
    // evento de status traz o mesmo destinatário com o aparelho junto.
    const gravadoAoEnviar = empacotarId({
      remoteJid: JID,
      fromMe: true,
      id: '3EB0C767D26A1D8A5C1D',
    });
    const vindoNoStatus = empacotarId({
      remoteJid: `${TELEFONE}:47@s.whatsapp.net`,
      fromMe: true,
      id: '3EB0C767D26A1D8A5C1D',
    });

    expect(vindoNoStatus).toBe(gravadoAoEnviar);
  });
});

describe('o que não dá pra normalizar', () => {
  it('deixa o @lid como veio — dele não se recupera o telefone', () => {
    // Normalizar inventando um número seria pior que não normalizar: duas
    // conversas diferentes cairiam na mesma chave.
    const lid = '199887766554433@lid';
    expect(normalizarJid(lid)).toBe(lid);
  });

  it('e por isso o id da mensagem continua acessível', () => {
    // É a rede de segurança da busca (ver acharPeloIdExterno): o id da
    // mensagem é único e nunca muda de forma.
    const externo = empacotarId({
      remoteJid: '199887766554433@lid',
      fromMe: true,
      id: '3EB0ABC',
    });

    expect(idDaMensagem(externo)).toBe('3EB0ABC');
  });

  it('id de outro provedor não vira pedaço nenhum', () => {
    // O `wamid` da Meta não é chave composta; tratá-lo como tal faria a
    // busca de reserva procurar por um pedaço que não existe.
    expect(idDaMensagem('wamid.HBgNNTUyNw==')).toBeNull();
  });
});

describe('ida e volta', () => {
  it('desempacota o que empacotou', () => {
    const chave = { remoteJid: JID, fromMe: false, id: 'XYZ' };
    expect(desempacotarId(empacotarId(chave))).toEqual(chave);
  });

  it('telefone e JID são conversíveis nos dois sentidos', () => {
    expect(telefoneDoJid(jidDoTelefone('+55 (27) 99999-8888'))).toBe(TELEFONE);
  });

  it('grupo não vira conversa de cliente', () => {
    expect(telefoneDoJid('120363000@g.us')).toBeNull();
  });
});
