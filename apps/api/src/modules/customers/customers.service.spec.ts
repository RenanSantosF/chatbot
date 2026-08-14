import { CustomersService } from './customers.service';

/**
 * O cadastro do cliente é alimentado por três origens que discordam entre
 * si: o perfil do WhatsApp (o nome que a pessoa escolheu), a agenda do
 * celular da empresa (a etiqueta que a empresa deu) e a planilha do
 * escritório (o que estava no sistema antigo).
 *
 * A regra é sempre a mesma e é o que estes testes guardam: preencher
 * buraco, nunca sobrescrever informação boa. A planilha costuma ser mais
 * pobre que o que o atendimento já descobriu.
 */
function servicoCom(clientes: Record<string, unknown>[]) {
  const criados: Record<string, unknown>[] = [];
  const atualizados: { id: string; data: Record<string, unknown> }[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      customer: {
        findFirst: jest
          .fn()
          .mockImplementation(
            (args: { where: { phone?: string } }) =>
              clientes.find((c) => c.phone === args.where.phone) ?? null,
          ),
        create: jest.fn().mockImplementation((args: { data: unknown }) => {
          criados.push(args.data as Record<string, unknown>);
          return { id: 'novo', ...(args.data as object) };
        }),
        update: jest
          .fn()
          .mockImplementation(
            (args: { where: { id: string }; data: unknown }) => {
              atualizados.push({
                id: args.where.id,
                data: args.data as Record<string, unknown>,
              });
              return { id: args.where.id, ...(args.data as object) };
            },
          ),
      },
    },
  };

  return {
    service: new CustomersService(prisma as never),
    prisma,
    criados,
    atualizados,
  };
}

describe('contato vindo da agenda do celular', () => {
  it('cria quem ainda não existe', async () => {
    const { service, criados } = servicoCom([]);

    await service.upsertFromAddressBook({
      phone: '5527999998888',
      name: 'Ana do financeiro',
    });

    expect(criados[0]).toMatchObject({
      phone: '5527999998888',
      name: 'Ana do financeiro',
    });
  });

  it('sem nome na agenda, o telefone serve de rótulo', async () => {
    const { service, criados } = servicoCom([]);

    await service.upsertFromAddressBook({ phone: '5527999998888' });

    expect(criados[0].name).toBe('5527999998888');
  });

  it('não sobrescreve o nome que o cliente escolheu no perfil dele', async () => {
    // O nome do perfil do WhatsApp vale mais que a etiqueta da agenda.
    const { service, atualizados } = servicoCom([
      { id: 'c1', phone: '5527999998888', name: 'Ana Souza' },
    ]);

    await service.upsertFromAddressBook({
      phone: '5527999998888',
      name: 'Ana - cobrança',
    });

    expect(atualizados).toEqual([]);
  });

  it('preenche quando o cliente entrou chamado pelo próprio número', async () => {
    const { service, atualizados } = servicoCom([
      { id: 'c1', phone: '5527999998888', name: '5527999998888' },
    ]);

    await service.upsertFromAddressBook({
      phone: '5527999998888',
      name: 'Ana Souza',
    });

    expect(atualizados[0].data).toEqual({ name: 'Ana Souza' });
  });

  it('nome só com espaço não conta como nome', async () => {
    const { service, atualizados } = servicoCom([
      { id: 'c1', phone: '5527999998888', name: '   ' },
    ]);

    await service.upsertFromAddressBook({
      phone: '5527999998888',
      name: 'Ana Souza',
    });

    expect(atualizados[0].data).toEqual({ name: 'Ana Souza' });
  });
});

describe('importação de planilha', () => {
  it('conta o que criou e o que atualizou separadamente', async () => {
    const { service } = servicoCom([
      { id: 'c1', phone: '5527999998888', name: '5527999998888', email: null },
    ]);

    const relatorio = await service.importContacts([
      { name: 'Ana Souza', phone: '5527999998888' },
      { name: 'Bruno', phone: '5527888887777' },
    ]);

    expect(relatorio).toEqual({ criados: 1, atualizados: 1 });
  });

  it('não conta como atualizado quem não mudou em nada', async () => {
    // Um relatório dizendo "50 atualizados" quando nada mudou faz a empresa
    // achar que a planilha sobrescreveu o cadastro inteiro.
    const { service, atualizados } = servicoCom([
      {
        id: 'c1',
        phone: '5527999998888',
        name: 'Ana Souza',
        email: 'ana@exemplo.com',
      },
    ]);

    const relatorio = await service.importContacts([
      { name: 'Ana S.', phone: '5527999998888', email: 'outro@exemplo.com' },
    ]);

    expect(relatorio).toEqual({ criados: 0, atualizados: 0 });
    expect(atualizados).toEqual([]);
  });

  it('preenche só o e-mail que faltava, sem tocar no nome bom', async () => {
    const { service, atualizados } = servicoCom([
      { id: 'c1', phone: '5527999998888', name: 'Ana Souza', email: null },
    ]);

    await service.importContacts([
      { name: 'ANA', phone: '5527999998888', email: 'ana@exemplo.com' },
    ]);

    expect(atualizados[0].data).toEqual({ email: 'ana@exemplo.com' });
  });

  it('não troca um nome de verdade pelo telefone da planilha', async () => {
    const { service, atualizados } = servicoCom([
      { id: 'c1', phone: '5527999998888', name: '5527999998888', email: null },
    ]);

    await service.importContacts([
      { name: '5527999998888', phone: '5527999998888' },
    ]);

    expect(atualizados).toEqual([]);
  });
});

describe('cliente chegando por mensagem', () => {
  it('reaproveita o cadastro na segunda mensagem', async () => {
    const { service, criados } = servicoCom([
      { id: 'c1', phone: '5527999998888', name: 'Ana' },
    ]);

    const cliente = await service.findOrCreateByPhone({
      phone: '5527999998888',
      name: 'Ana',
    });

    expect(cliente).toMatchObject({ id: 'c1' });
    expect(criados).toEqual([]);
  });

  it('sobrevive à corrida de duas mensagens quase simultâneas', async () => {
    // Duas mensagens do mesmo número novo chegando juntas: a segunda bate
    // na chave única. Estourar aqui perderia a mensagem do cliente.
    const { service, prisma } = servicoCom([]);

    prisma.db.customer.create.mockRejectedValueOnce({ code: 'P2002' });
    prisma.db.customer.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'c1', phone: '5527999998888' });

    await expect(
      service.findOrCreateByPhone({ phone: '5527999998888', name: 'Ana' }),
    ).resolves.toMatchObject({ id: 'c1' });
  });

  it('erro que não é corrida continua estourando', async () => {
    // Engolir qualquer falha aqui esconderia problema de banco atrás de um
    // "cliente não encontrado".
    const { service, prisma } = servicoCom([]);
    prisma.db.customer.create.mockRejectedValueOnce(new Error('banco fora'));

    await expect(
      service.findOrCreateByPhone({ phone: '5527999998888', name: 'Ana' }),
    ).rejects.toThrow('banco fora');
  });
});
