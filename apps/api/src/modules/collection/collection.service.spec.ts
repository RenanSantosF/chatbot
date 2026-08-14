import { CollectionService } from './collection.service';
import type { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

/**
 * `missingRequired` é o que decide se uma conversa pode ir pra um humano.
 * Errar pra menos entrega o atendimento sem os dados; errar pra mais
 * prende o cliente num interrogatório que não termina. Por isso vale
 * testar cada origem de dado separadamente — nome, e-mail e campo livre
 * são lidos de lugares diferentes.
 */
function servicoCom(opcoes: {
  campos: Record<string, unknown>[];
  conversa: Record<string, unknown> | null;
}) {
  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      collectionField: {
        findMany: jest.fn().mockResolvedValue(opcoes.campos),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue(opcoes.conversa),
      },
    },
  } as unknown as TenantPrismaService;

  return new CollectionService(prisma);
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

describe('CollectionService.missingRequired', () => {
  it('não exige nada quando a empresa não configurou campos', async () => {
    const service = servicoCom({ campos: [], conversa: null });
    await expect(service.missingRequired('conversa-1')).resolves.toEqual([]);
  });

  it('ignora campos marcados como opcionais', async () => {
    const service = servicoCom({
      campos: [campo({ required: false })],
      conversa: {
        collectedData: {},
        customer: { name: 'Ana', email: null, metadata: {} },
      },
    });
    await expect(service.missingRequired('conversa-1')).resolves.toEqual([]);
  });

  it('aponta o campo obrigatório que ainda não foi coletado', async () => {
    const service = servicoCom({
      campos: [campo()],
      conversa: {
        collectedData: {},
        customer: { name: 'Ana', email: null, metadata: {} },
      },
    });
    await expect(service.missingRequired('conversa-1')).resolves.toEqual([
      'CPF',
    ]);
  });

  it('aceita o valor vindo do cadastro do cliente, não só da conversa', async () => {
    // O cliente já informou o CPF num atendimento anterior; perguntar de
    // novo passaria a impressão de que ninguém anota nada.
    const service = servicoCom({
      campos: [campo()],
      conversa: {
        collectedData: {},
        customer: {
          name: 'Ana',
          email: null,
          metadata: { cpf: '12345678900' },
        },
      },
    });
    await expect(service.missingRequired('conversa-1')).resolves.toEqual([]);
  });

  describe('nome', () => {
    const campoNome = campo({ key: 'nome', label: 'Nome', target: 'NAME' });

    it('considera coletado quando há nome de verdade', async () => {
      const service = servicoCom({
        campos: [campoNome],
        conversa: {
          collectedData: {},
          customer: { name: 'Ana Souza', email: null, metadata: {} },
        },
      });
      await expect(service.missingRequired('conversa-1')).resolves.toEqual([]);
    });

    it('não aceita telefone no lugar do nome', async () => {
      // É o padrão de quem não tem nome no perfil do WhatsApp: o contato
      // entra chamado pelo próprio número, e isso não é um nome.
      const service = servicoCom({
        campos: [campoNome],
        conversa: {
          collectedData: {},
          customer: { name: '+55 27 99883-6017', email: null, metadata: {} },
        },
      });
      await expect(service.missingRequired('conversa-1')).resolves.toEqual([
        'Nome',
      ]);
    });

    it('não aceita nome em branco', async () => {
      const service = servicoCom({
        campos: [campoNome],
        conversa: {
          collectedData: {},
          customer: { name: '   ', email: null, metadata: {} },
        },
      });
      await expect(service.missingRequired('conversa-1')).resolves.toEqual([
        'Nome',
      ]);
    });
  });

  describe('e-mail', () => {
    const campoEmail = campo({
      key: 'email',
      label: 'E-mail',
      target: 'EMAIL',
    });

    it('cobra quando o cadastro está sem e-mail', async () => {
      const service = servicoCom({
        campos: [campoEmail],
        conversa: {
          collectedData: {},
          customer: { name: 'Ana', email: null, metadata: {} },
        },
      });
      await expect(service.missingRequired('conversa-1')).resolves.toEqual([
        'E-mail',
      ]);
    });

    it('não cobra quando já existe', async () => {
      const service = servicoCom({
        campos: [campoEmail],
        conversa: {
          collectedData: {},
          customer: { name: 'Ana', email: 'ana@exemplo.com', metadata: {} },
        },
      });
      await expect(service.missingRequired('conversa-1')).resolves.toEqual([]);
    });
  });

  it('devolve todos os que faltam, na ordem configurada', async () => {
    const service = servicoCom({
      campos: [
        campo({ key: 'nome', label: 'Nome', target: 'NAME' }),
        campo({ key: 'cpf', label: 'CPF' }),
        campo({ key: 'processo', label: 'Número do processo' }),
      ],
      conversa: {
        collectedData: { cpf: '12345678900' },
        customer: { name: '5527998836017', email: null, metadata: {} },
      },
    });

    await expect(service.missingRequired('conversa-1')).resolves.toEqual([
      'Nome',
      'Número do processo',
    ]);
  });

  it('não trava a conversa quando ela sumiu do banco', async () => {
    const service = servicoCom({ campos: [campo()], conversa: null });
    await expect(service.missingRequired('conversa-fantasma')).resolves.toEqual(
      [],
    );
  });
});
