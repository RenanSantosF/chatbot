import { destinatariosDaConversa } from './destinatarios-da-conversa';

/**
 * Quem recebe o AVISO de uma conversa — tempo real e push — tem que ser
 * exatamente quem CONSEGUE VER ela (ver `recorteDeVisibilidade`, em
 * `conversations.service.ts`, e `conversations.recorte.spec.ts`, que
 * cobre o mesmo recorte do lado de "consigo abrir pelo id"). Esta função é
 * o meio-campo entre os dois: pega o filtro e devolve uma lista de
 * pessoas, porque socket e push não sabem fazer WHERE.
 */
const USUARIOS = [
  { id: 'dono', role: 'OWNER' },
  { id: 'admin', role: 'ADMIN' },
  { id: 'user-do-setor', role: 'AGENT' },
  { id: 'user-de-fora', role: 'AGENT' },
];

function montarPrisma(membrosDoSetor: string[]) {
  return {
    db: {
      user: { findMany: jest.fn().mockResolvedValue(USUARIOS) },
      queueMember: {
        findMany: jest
          .fn()
          .mockResolvedValue(membrosDoSetor.map((userId) => ({ userId }))),
      },
    },
  } as never;
}

describe('destinatariosDaConversa', () => {
  it('com queueVisibility ALL, todo mundo recebe — mesmo sem setor batendo', async () => {
    const prisma = montarPrisma(['user-do-setor']);

    const lista = await destinatariosDaConversa(
      prisma,
      { queueId: 'setor-financeiro', assignedUserId: null },
      'ALL',
    );

    expect(lista.sort()).toEqual(
      ['dono', 'admin', 'user-do-setor', 'user-de-fora'].sort(),
    );
  });

  it('conversa sem setor: todo mundo recebe, mesmo com visibilidade restrita', async () => {
    const prisma = montarPrisma([]);

    const lista = await destinatariosDaConversa(
      prisma,
      { queueId: null, assignedUserId: null },
      'RESTRITA',
    );

    expect(lista.sort()).toEqual(
      ['dono', 'admin', 'user-do-setor', 'user-de-fora'].sort(),
    );
  });

  it('visibilidade restrita e conversa com setor: quem é de FORA do setor não recebe', async () => {
    const prisma = montarPrisma(['user-do-setor']);

    const lista = await destinatariosDaConversa(
      prisma,
      { queueId: 'setor-financeiro', assignedUserId: null },
      'RESTRITA',
    );

    expect(lista).not.toContain('user-de-fora');
  });

  it('visibilidade restrita: dono e admin recebem de qualquer setor', async () => {
    const prisma = montarPrisma(['user-do-setor']);

    const lista = await destinatariosDaConversa(
      prisma,
      { queueId: 'setor-financeiro', assignedUserId: null },
      'RESTRITA',
    );

    expect(lista).toEqual(expect.arrayContaining(['dono', 'admin']));
  });

  it('visibilidade restrita: quem é do setor recebe', async () => {
    const prisma = montarPrisma(['user-do-setor']);

    const lista = await destinatariosDaConversa(
      prisma,
      { queueId: 'setor-financeiro', assignedUserId: null },
      'RESTRITA',
    );

    expect(lista).toContain('user-do-setor');
  });

  it('atribuída a alguém de fora do setor: essa pessoa recebe mesmo assim', async () => {
    // A mesma exceção de `recorteDeVisibilidade`: perder de vista uma
    // conversa que é SUA, só porque o setor mudou, seria pior que não ter
    // o recorte — a pessoa não saberia que o cliente dela respondeu.
    const prisma = montarPrisma([]);

    const lista = await destinatariosDaConversa(
      prisma,
      { queueId: 'setor-financeiro', assignedUserId: 'user-de-fora' },
      'RESTRITA',
    );

    expect(lista).toContain('user-de-fora');
  });
});
