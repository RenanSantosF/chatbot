import { ConflictException, NotFoundException } from '@nestjs/common';
import { TagsService } from './tags.service';

/**
 * Etiqueta é organização, e organização que duplica não organiza.
 *
 * Duas etiquetas "Orçamento" na mesma empresa produzem exatamente o
 * problema que a etiqueta veio resolver: metade das conversas numa, metade
 * na outra, e o filtro mostrando metade do que deveria — sem ninguém
 * perceber, porque as duas se parecem na tela.
 */
function servicoCom(existentes: { id: string; name: string }[] = []) {
  const criadas: Record<string, unknown>[] = [];
  const ligacoes: Record<string, unknown>[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      tag: {
        findMany: jest.fn().mockResolvedValue(
          existentes.map((item) => ({
            ...item,
            color: 'cinza',
            _count: { conversations: 3 },
          })),
        ),
        findFirst: jest
          .fn()
          .mockImplementation((args: { where: Record<string, unknown> }) => {
            const { name, id } = args.where as {
              name?: string;
              id?: string | { not: string };
            };
            if (typeof id === 'string') {
              return existentes.find((item) => item.id === id) ?? null;
            }
            const excluido = typeof id === 'object' ? id.not : null;
            return (
              existentes.find(
                (item) => item.name === name && item.id !== excluido,
              ) ?? null
            );
          }),
        create: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) => {
            criadas.push(args.data);
            return { id: 'nova', ...args.data };
          }),
        update: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) => ({
            id: 'existente',
            ...args.data,
          })),
        delete: jest.fn().mockResolvedValue({}),
      },
      conversationTag: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) => {
            ligacoes.push(args.data);
            return args.data;
          }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    },
  };

  return { service: new TagsService(prisma as never), criadas, ligacoes, prisma };
}

describe('criando etiqueta', () => {
  it('nome repetido é recusado', async () => {
    const { service } = servicoCom([{ id: 't1', name: 'Orçamento' }]);

    await expect(service.create({ name: 'Orçamento' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('espaço a mais não cria uma "segunda" etiqueta', async () => {
    // "Orçamento " e "Orçamento" são a mesma coisa pra quem lê, e seriam
    // duas linhas diferentes pro banco.
    const { service } = servicoCom([{ id: 't1', name: 'Orçamento' }]);

    await expect(service.create({ name: '  Orçamento  ' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('espaços no meio viram um só', async () => {
    const { service, criadas } = servicoCom();

    await service.create({ name: 'Segunda    via' });

    expect(criadas[0].name).toBe('Segunda via');
  });

  it('nome em branco não vira etiqueta', async () => {
    const { service } = servicoCom();

    await expect(service.create({ name: '   ' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('sem cor escolhida, nasce cinza', async () => {
    const { service, criadas } = servicoCom();

    await service.create({ name: 'Reclamação' });

    expect(criadas[0].color).toBe('cinza');
  });
});

describe('renomeando', () => {
  it('manter o próprio nome não é conflito', async () => {
    const { service } = servicoCom([{ id: 't1', name: 'Orçamento' }]);

    await expect(
      service.update('t1', { name: 'Orçamento', color: 'azul' }),
    ).resolves.toMatchObject({ color: 'azul' });
  });

  it('tomar o nome de outra é recusado', async () => {
    const { service } = servicoCom([
      { id: 't1', name: 'Orçamento' },
      { id: 't2', name: 'Reclamação' },
    ]);

    await expect(service.update('t2', { name: 'Orçamento' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('etiqueta que não existe não é renomeada', async () => {
    const { service } = servicoCom();

    await expect(service.update('sumida', { name: 'X' })).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('marcando a conversa', () => {
  it('marcar duas vezes não duplica a ligação', async () => {
    // Dois cliques rápidos no mesmo item da lista acontecem, e a segunda
    // gravação estouraria a restrição de unicidade na cara de quem atende.
    const { service, prisma } = servicoCom([{ id: 't1', name: 'Orçamento' }]);
    prisma.db.conversationTag.findFirst.mockResolvedValue({ id: 'l1' });

    await service.marcar('conversa-1', 't1');

    expect(prisma.db.conversationTag.create).not.toHaveBeenCalled();
  });

  it('a ligação carrega o tenant, como todo o resto', async () => {
    // Sem o tenantId a tabela do meio ficaria fora do isolamento por
    // empresa que o resto do sistema aplica.
    const { service, ligacoes } = servicoCom([{ id: 't1', name: 'Orçamento' }]);

    await service.marcar('conversa-1', 't1');

    expect(ligacoes[0]).toMatchObject({
      tenantId: 'tenant-teste',
      conversationId: 'conversa-1',
      tagId: 't1',
    });
  });

  it('etiqueta inexistente não gruda em conversa nenhuma', async () => {
    const { service } = servicoCom();

    await expect(service.marcar('conversa-1', 'sumida')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('desmarcar o que já não está lá não é erro', async () => {
    // O resultado é o que a pessoa queria: a etiqueta não está mais na
    // conversa. Um erro aqui só apareceria depois de um clique duplo.
    const { service } = servicoCom();

    await expect(service.desmarcar('conversa-1', 't1')).resolves.toEqual({
      ok: true,
    });
  });
});

describe('a lista', () => {
  it('diz em quantas conversas cada etiqueta está', async () => {
    // É o que muda a decisão de apagar: em três conversas é um ajuste, em
    // trezentas é uma perda de organização.
    const { service } = servicoCom([{ id: 't1', name: 'Orçamento' }]);

    const [primeira] = await service.list();

    expect(primeira.conversationCount).toBe(3);
    expect(primeira).not.toHaveProperty('_count');
  });
});
