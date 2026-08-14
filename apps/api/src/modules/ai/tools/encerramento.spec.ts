import { AiToolsService } from './ai-tools.service';

/**
 * A ferramenta com que a IA encerra o atendimento.
 *
 * Ela existe porque faltava: a IA escrevia "atendimento encerrado por
 * aqui" e não tinha como encerrar coisa nenhuma — o cliente lia que tinha
 * acabado, o painel continuava marcando "aguardando cliente", e a conversa
 * ficava parada num estado que ninguém revisita.
 *
 * O risco do remédio é o oposto do defeito: encerrar o que não devia. Uma
 * conversa que espera atendente, tirada da fila por uma despedida
 * apressada da IA, é um cliente que fica sem resposta e ninguém percebe.
 * Metade dos testes daqui é sobre isso.
 */
function servicoCom(
  conversa: { status?: string; assignedUserId?: string | null } = {},
) {
  const escritas: Record<string, unknown>[] = [];
  const notas: string[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          status: conversa.status ?? 'WAITING_CUSTOMER',
          assignedUserId: conversa.assignedUserId ?? null,
        }),
        update: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) => {
            escritas.push(args.data);
            return { id: 'conversa-1', messages: [] };
          }),
      },
      message: {
        create: jest
          .fn()
          .mockImplementation((args: { data: { content: string } }) => {
            notas.push(args.data.content);
            return {};
          }),
      },
      aiTool: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ enabled: true, permission: 'ALLOW' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      aiSettings: {
        findFirst: jest.fn().mockResolvedValue({ memoryMode: 'NONE' }),
      },
    },
  };

  const service = new AiToolsService(
    prisma as never,
    { emitToTenant: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, escritas, notas };
}

const encerrar = (service: AiToolsService) =>
  service.execute(
    'resolveConversation',
    { reason: 'Dúvida sobre horário respondida.' },
    'conversa-1',
  );

describe('a IA encerra o atendimento', () => {
  it('marca como resolvida', async () => {
    const { service, escritas } = servicoCom();

    const resultado = await encerrar(service);

    expect(resultado.output).toMatchObject({ status: 'resolved' });
    expect(escritas[0]).toMatchObject({ status: 'RESOLVED' });
  });

  it('para o relógio da fila', async () => {
    const { service, escritas } = servicoCom();

    await encerrar(service);

    expect(escritas[0].waitingSince).toBeNull();
  });

  it('registra no histórico por que encerrou', async () => {
    // Quem abrir a conversa depois precisa saber que foi a IA, e do quê.
    const { service, notas } = servicoCom();

    await encerrar(service);

    expect(notas[0]).toContain('IA encerrou o atendimento');
    expect(notas[0]).toContain('horário');
  });
});

describe('o que a IA não pode encerrar', () => {
  it('conversa que já tem dono', async () => {
    const { service, escritas } = servicoCom({ assignedUserId: 'user-ana' });

    const resultado = await encerrar(service);

    expect(resultado.output).toMatchObject({ status: 'blocked' });
    expect(escritas).toHaveLength(0);
  });

  it('conversa esperando alguém da equipe assumir', async () => {
    // O caso perigoso: a IA transfere e se despede no mesmo fôlego.
    const { service, escritas } = servicoCom({ status: 'WAITING_AGENT' });

    const resultado = await encerrar(service);

    expect(resultado.output).toMatchObject({ status: 'blocked' });
    expect(escritas).toHaveLength(0);
  });
});
