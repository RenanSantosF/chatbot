import { NotFoundException } from '@nestjs/common';
import { CollectionService } from './collection.service';

/**
 * O que a IA coletou, indo pro lugar certo.
 *
 * Nome e e-mail sobem pro cadastro do cliente — é o que faz o contato
 * deixar de se chamar "5527999..." e passar a ter nome de verdade na lista.
 * O resto fica no cliente como metadado, pra a próxima conversa já saber.
 *
 * Guardar no lugar errado tem consequência visível: o dado some da ficha, a
 * barreira de transferência continua achando que falta, e o cliente é
 * perguntado de novo pelo que acabou de informar.
 */
function servicoCom(campos: Record<string, unknown>[]) {
  const conversa = {
    id: 'conversa-1',
    customerId: 'cliente-1',
    collectedData: {},
    customer: { name: 'Ana', email: null, metadata: {} },
  };

  const escritas: { alvo: string; data: Record<string, unknown> }[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      collectionField: { findMany: jest.fn().mockResolvedValue(campos) },
      conversation: {
        findFirst: jest.fn().mockResolvedValue(conversa),
        update: jest.fn().mockImplementation((args: { data: unknown }) => {
          escritas.push({
            alvo: 'conversa',
            data: args.data as Record<string, unknown>,
          });
          return conversa;
        }),
      },
      customer: {
        update: jest.fn().mockImplementation((args: { data: unknown }) => {
          escritas.push({
            alvo: 'cliente',
            data: args.data as Record<string, unknown>,
          });
          return {};
        }),
      },
    },
  };

  return { service: new CollectionService(prisma as never), escritas, prisma };
}

const campo = (extra: Record<string, unknown> = {}) => ({
  key: 'cpf',
  label: 'CPF',
  type: 'DOCUMENT',
  target: 'METADATA',
  required: true,
  active: true,
  ...extra,
});

const doCliente = (
  escritas: { alvo: string; data: Record<string, unknown> }[],
) => escritas.find((e) => e.alvo === 'cliente')?.data ?? {};
const daConversa = (
  escritas: { alvo: string; data: Record<string, unknown> }[],
) => escritas.find((e) => e.alvo === 'conversa')?.data ?? {};

describe('para onde cada dado vai', () => {
  it('campo de nome vira o nome do cadastro', async () => {
    const { service, escritas } = servicoCom([
      campo({ key: 'nome', label: 'Nome', target: 'NAME' }),
    ]);

    await service.save('conversa-1', { nome: 'Ana Souza' });

    expect(doCliente(escritas).name).toBe('Ana Souza');
  });

  it('campo de e-mail vira o e-mail do cadastro', async () => {
    const { service, escritas } = servicoCom([
      campo({ key: 'email', label: 'E-mail', target: 'EMAIL' }),
    ]);

    await service.save('conversa-1', { email: 'ana@exemplo.com' });

    expect(doCliente(escritas).email).toBe('ana@exemplo.com');
  });

  it('campo livre fica no metadado do cliente, pra próxima conversa saber', async () => {
    const { service, escritas } = servicoCom([campo()]);

    await service.save('conversa-1', { cpf: '12345678900' });

    expect(doCliente(escritas).metadata).toMatchObject({ cpf: '12345678900' });
  });

  it('tudo fica registrado na conversa também', async () => {
    // É o que a barreira de transferência consulta.
    const { service, escritas } = servicoCom([campo()]);

    await service.save('conversa-1', { cpf: '12345678900' });

    expect(daConversa(escritas).collectedData).toMatchObject({
      cpf: '12345678900',
    });
  });

  it('nome não vaza pro metadado — senão apareceria duas vezes na ficha', async () => {
    const { service, escritas } = servicoCom([
      campo({ key: 'nome', label: 'Nome', target: 'NAME' }),
    ]);

    await service.save('conversa-1', { nome: 'Ana Souza' });

    expect(doCliente(escritas).metadata).not.toHaveProperty('nome');
  });
});

describe('o que a IA manda torto', () => {
  it('espaço em volta é aparado', async () => {
    const { service, escritas } = servicoCom([campo()]);

    await service.save('conversa-1', { cpf: '  12345678900  ' });

    expect(doCliente(escritas).metadata).toMatchObject({ cpf: '12345678900' });
  });

  it('valor vazio é ignorado em vez de apagar o que já havia', async () => {
    // O modelo às vezes "confirma" um campo mandando string vazia. Gravar
    // isso apagaria o dado bom e faria a barreira cobrar de novo.
    const { service, escritas } = servicoCom([campo()]);

    await service.save('conversa-1', { cpf: '   ' });

    expect(daConversa(escritas).collectedData).not.toHaveProperty('cpf');
  });

  it('chave que a empresa não configurou não é descartada', async () => {
    // Perder o dado seria pior que guardar um a mais: o cliente informou
    // alguma coisa, e o atendente precisa poder ver.
    const { service, escritas } = servicoCom([campo()]);

    await service.save('conversa-1', { apelido: 'Aninha' });

    expect(doCliente(escritas).metadata).toMatchObject({ apelido: 'Aninha' });
  });

  it('preserva o que já estava guardado no cliente', async () => {
    const { service, escritas, prisma } = servicoCom([campo()]);
    prisma.db.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      customerId: 'cliente-1',
      collectedData: { processo: '0001234-55' },
      customer: { metadata: { profissao: 'advogada' } },
    });

    await service.save('conversa-1', { cpf: '12345678900' });

    expect(doCliente(escritas).metadata).toMatchObject({
      profissao: 'advogada',
      cpf: '12345678900',
    });
    expect(daConversa(escritas).collectedData).toMatchObject({
      processo: '0001234-55',
      cpf: '12345678900',
    });
  });
});

describe('resposta pra IA', () => {
  it('devolve o que ainda falta, pra ela voltar e perguntar', async () => {
    const { service } = servicoCom([
      campo(),
      campo({ key: 'processo', label: 'Número do processo' }),
    ]);

    const resultado = await service.save('conversa-1', { cpf: '12345678900' });

    expect(resultado.saved).toEqual(['cpf']);
    expect(resultado.missing).toContain('Número do processo');
  });

  it('conversa que sumiu do banco dá erro claro, não escrita cega', async () => {
    const { service, prisma } = servicoCom([campo()]);
    prisma.db.conversation.findFirst.mockResolvedValue(null);

    await expect(
      service.save('conversa-fantasma', { cpf: '1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
