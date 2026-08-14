import { AiToolsService } from './ai-tools.service';
import type { AiToolPermission } from '../../../../generated/prisma/client';

/**
 * O que a tela promete é o que a execução faz.
 *
 * A configuração de cada ferramenta mora em duas cabeças: a tela de
 * Configurações > IA > Ferramentas, que mostra o estado, e a execução, que
 * decide se a ação acontece. Quando as duas discordam, o defeito é do tipo
 * que ninguém consegue diagnosticar olhando o painel — ele diz "Permitir"
 * em verde enquanto nada acontece.
 *
 * Foi o que houve: o padrão de quem nunca abriu a tela era "Permitir" na
 * listagem e "Aprovar" na execução. Numa conta nova (nenhuma linha gravada,
 * que é o caso comum) a IA recebia a ferramenta de transferir, chamava, e
 * levava de volta "isto exige aprovação de um humano". O cliente não era
 * transferido, e cada tentativa deixava uma tarefa "Aprovar: Transferir
 * atendimento" pra trás.
 */
function servicoCom(
  configuracoes: {
    key: string;
    enabled: boolean;
    permission: AiToolPermission;
  }[] = [],
) {
  const tarefas: { title: string }[] = [];
  const escritas: Record<string, unknown>[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        update: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) => {
            escritas.push(args.data);
            return { id: 'conversa-1', messages: [] };
          }),
      },
      message: { create: jest.fn().mockResolvedValue({}) },
      task: {
        create: jest
          .fn()
          .mockImplementation((args: { data: { title: string } }) => {
            tarefas.push(args.data);
            return {};
          }),
      },
      aiTool: {
        findMany: jest.fn().mockResolvedValue(configuracoes),
        findFirst: jest
          .fn()
          .mockImplementation(
            (args: { where: { key: string } }) =>
              configuracoes.find((item) => item.key === args.where.key) ?? null,
          ),
      },
      aiSettings: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ memoryMode: 'IMPORTANT_ONLY' }),
      },
      queue: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };

  const service = new AiToolsService(
    prisma as never,
    { emitToTenant: jest.fn() } as never,
    {
      findByKey: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
    } as never,
    {
      resolveTarget: jest.fn().mockResolvedValue(null),
      listForAi: jest.fn().mockResolvedValue([]),
    } as never,
    {
      missingRequired: jest.fn().mockResolvedValue([]),
      describeForAi: jest.fn().mockResolvedValue([]),
    } as never,
  );

  return { service, tarefas, escritas };
}

const transferir = (service: AiToolsService) =>
  service.execute(
    'transferToQueue',
    { reason: 'Cliente pediu um humano', summary: 'Quer falar com alguém.' },
    'conversa-1',
  );

describe('empresa que nunca abriu a tela de ferramentas', () => {
  it('transfere de verdade, sem parar pra pedir aprovação', async () => {
    const { service, escritas, tarefas } = servicoCom([]);

    const resultado = await transferir(service);

    expect(resultado.error).toBeUndefined();
    expect(escritas[0]).toMatchObject({ status: 'WAITING_AGENT' });
    expect(tarefas).toEqual([]);
  });

  it('a tela mostra o mesmo padrão que a execução usa', async () => {
    // É esta igualdade que estava quebrada: verde na tela, "aprovação
    // pendente" na execução.
    const { service } = servicoCom([]);

    const listadas = await service.listConfigured();

    expect(listadas.every((tool) => tool.enabled)).toBe(true);
    expect(listadas.every((tool) => tool.permission === 'ALLOW')).toBe(true);
  });
});

describe('quando a empresa configurou', () => {
  it('"Aprovar" segura a ação e abre tarefa pra alguém revisar', async () => {
    const { service, escritas, tarefas } = servicoCom([
      {
        key: 'transferToQueue',
        enabled: true,
        permission: 'REQUIRES_APPROVAL',
      },
    ]);

    const resultado = await transferir(service);

    expect(resultado.error).toContain('aprovação');
    expect(escritas).toEqual([]);
    expect(tarefas[0].title).toContain('Transferir atendimento');
  });

  it('"Negar" não executa nem vira tarefa', async () => {
    const { service, escritas, tarefas } = servicoCom([
      { key: 'transferToQueue', enabled: true, permission: 'DENY' },
    ]);

    const resultado = await transferir(service);

    expect(resultado.error).toBeDefined();
    expect(escritas).toEqual([]);
    expect(tarefas).toEqual([]);
  });

  it('ferramenta desligada não executa nem se o modelo chamar pelo nome', async () => {
    // Desligada, ela some da lista oferecida ao modelo — mas o nome dela
    // continua no histórico da conversa, e o pedido pode voltar de lá. Quem
    // decide o que acontece é esta função, não o prompt.
    const { service, escritas } = servicoCom([
      { key: 'transferToQueue', enabled: false, permission: 'ALLOW' },
    ]);

    const resultado = await transferir(service);

    expect(resultado.error).toBeDefined();
    expect(escritas).toEqual([]);
  });

  it('desligada não é oferecida ao modelo', async () => {
    const { service } = servicoCom([
      { key: 'transferToQueue', enabled: false, permission: 'ALLOW' },
    ]);

    const declaradas = await service.getEnabledDeclarations();

    expect(declaradas.map((tool) => tool.name)).not.toContain(
      'transferToQueue',
    );
  });
});
