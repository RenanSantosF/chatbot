import { CustomersService } from './customers.service';

/**
 * A agenda do aparelho virando contato no painel.
 *
 * Esta é a regra que já errou nos dois sentidos. Primeiro aceitando
 * qualquer apelido — e a lista de "nova conversa" enchia de gente que a
 * empresa nunca salvou. Depois exigindo o campo `name`, que a Evolution
 * NÃO manda — e aí não importava contato nenhum: quem conectava uma conta
 * nova via a agenda vazia e achava que a sincronização não tinha rodado.
 *
 * O que a Evolution manda é `pushName`, com
 * `contact.name || contact.verifiedName || <o número>` dentro. O único
 * sinal que sobra é esse fallback: nome igual ao número quer dizer que
 * ninguém batizou aquela pessoa.
 */
function montar(existente: Record<string, unknown> | null = null) {
  const criados: Record<string, unknown>[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      customer: {
        findFirst: jest.fn().mockResolvedValue(existente),
        create: jest.fn().mockImplementation((args: { data: unknown }) => {
          criados.push(args.data as Record<string, unknown>);
          return { id: 'cliente-novo', ...(args.data as object) };
        }),
        update: jest.fn().mockResolvedValue({ id: 'cliente-1' }),
      },
    },
  };

  const service = new CustomersService(prisma as never);
  return { service, prisma, criados };
}

const jid = (telefone: string) => `${telefone}@s.whatsapp.net`;

describe('importar a agenda', () => {
  it('cria o contato que veio com nome no campo que a Evolution usa', async () => {
    const { service, criados } = montar();

    const resultado = await service.importarAgenda([
      { remoteJid: jid('5511999999999'), pushName: 'Richard do Mercado' },
    ]);

    expect(criados[0]).toMatchObject({
      phone: '5511999999999',
      name: 'Richard do Mercado',
    });
    expect(resultado).toEqual({ recebidos: 1, salvos: 1 });
  });

  it('o número no lugar do nome não vira contato', async () => {
    // É o fallback da Evolution quando não há nome nenhum. Gravar isso
    // criaria um contato chamado 5511999999999.
    const { service, criados } = montar();

    const resultado = await service.importarAgenda([
      { remoteJid: jid('5511999999999'), pushName: '5511999999999' },
    ]);

    expect(criados).toHaveLength(0);
    expect(resultado.salvos).toBe(0);
  });

  it('o número formatado também não passa', async () => {
    // Alguns servidores devolvem com o + na frente; é o mesmo caso.
    const { service, criados } = montar();

    await service.importarAgenda([
      { remoteJid: jid('5511999999999'), pushName: '+55 11 99999-9999' },
    ]);

    expect(criados).toHaveLength(0);
  });

  it('contato sem nome nenhum é ignorado em vez de virar linha vazia', async () => {
    const { service, criados } = montar();

    await service.importarAgenda([{ remoteJid: jid('5511999999999') }]);

    expect(criados).toHaveLength(0);
  });

  it('grupo não vira contato', async () => {
    const { service, criados } = montar();

    await service.importarAgenda([
      { id: '120363000000000000@g.us', name: 'Fornecedores' },
    ]);

    expect(criados).toHaveLength(0);
  });

  it('o nome SALVO na agenda ganha do apelido público', async () => {
    // Quando os dois campos vêm (Baileys direto, ou outra versão), o da
    // agenda é o nome pelo qual a empresa procura essa pessoa.
    const { service, criados } = montar();

    await service.importarAgenda([
      {
        id: jid('5511999999999'),
        name: 'Richard do Mercado',
        notify: 'Rick 🔥',
      },
    ]);

    expect(criados[0]).toMatchObject({ name: 'Richard do Mercado' });
  });

  it('nome de agenda corrige quem já estava gravado como "Você"', async () => {
    // A importação do histórico batizava o cliente com o nome que vinha na
    // mensagem — e nas nossas esse nome é "Você".
    const { service, prisma } = montar({
      id: 'cliente-1',
      phone: '5511999999999',
      name: 'Você',
    });

    await service.importarAgenda([
      { id: jid('5511999999999'), name: 'Richard Oliveira' },
    ]);

    expect(prisma.db.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Richard Oliveira' } }),
    );
  });

  it('um contato problemático não derruba a agenda inteira', async () => {
    const { service } = montar();
    let primeira = true;

    const service2 = service as unknown as {
      upsertFromAddressBook: jest.Mock;
    };
    service2.upsertFromAddressBook = jest.fn().mockImplementation(() => {
      if (primeira) {
        primeira = false;
        throw new Error('telefone impossível');
      }
      return { id: 'cliente-2' };
    });

    const resultado = await service.importarAgenda([
      { id: jid('5511999999999'), name: 'Um' },
      { id: jid('5527888888888'), name: 'Dois' },
    ]);

    expect(resultado).toEqual({ recebidos: 2, salvos: 1 });
  });
});
