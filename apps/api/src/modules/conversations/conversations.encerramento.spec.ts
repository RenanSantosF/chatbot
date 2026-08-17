import { ConversationsService } from './conversations.service';
import type { VerificacaoDaResposta } from '../ai/ai-guardrails';

/**
 * O que acontece DEPOIS de a IA dizer que encerrou.
 *
 * O defeito relatado em produção: o cliente leu "Atendimento encerrado por
 * aqui" e o painel continuou marcando a conversa como aguardando cliente.
 * Ninguém encerrou nada — a IA só escreveu a frase. Do lado do cliente o
 * assunto tinha acabado; do lado da empresa a conversa seguia viva num
 * estado que ninguém revisita.
 *
 * A regra que estes testes guardam: o painel diz o mesmo que o cliente
 * leu — mas nunca ao custo de tirar da fila um caso que espera gente.
 */
function montar(
  estado: { status?: string; assignedUserId?: string | null } = {},
) {
  const atualizacoes: Record<string, unknown>[] = [];
  const notas: Record<string, unknown>[] = [];

  const conversa = {
    id: 'conversa-1',
    status: estado.status ?? 'WAITING_CUSTOMER',
    assignedUserId: estado.assignedUserId ?? null,
    priority: 'NORMAL',
    customer: { id: 'cliente-1', phone: '5527999998888', name: 'Renan' },
    messages: [],
  };

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          status: conversa.status,
          assignedUserId: conversa.assignedUserId,
        }),
        update: jest.fn().mockImplementation((args: { data: unknown }) => {
          atualizacoes.push(args.data as Record<string, unknown>);
          return { ...conversa, ...(args.data as object) };
        }),
      },
      message: {
        create: jest.fn().mockImplementation((args: { data: unknown }) => {
          notas.push(args.data as Record<string, unknown>);
          return { id: 'msg-1', createdAt: new Date() };
        }),
      },
    },
  };

  const service = new ConversationsService(
    prisma as never,
    {} as never,
    { emitToTenant: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { transcreverSeAutomatico: jest.fn() } as never,
  );

  const aplicar = (verificacao: VerificacaoDaResposta) =>
    (
      service as unknown as {
        aplicarTravasDaIa: (
          id: string,
          v: VerificacaoDaResposta,
          p: string,
        ) => Promise<unknown>;
      }
    ).aplicarTravasDaIa('conversa-1', verificacao, 'NORMAL');

  return { aplicar, atualizacoes, notas };
}

const ENCERROU: VerificacaoDaResposta = {
  precisaHandoff: false,
  encerrar: true,
  motivo: 'O cliente foi avisado de que o atendimento estava encerrado.',
};

describe('a IA disse que encerrou', () => {
  it('a conversa passa mesmo a RESOLVED', async () => {
    const { aplicar, atualizacoes } = montar();

    await aplicar(ENCERROU);

    expect(atualizacoes[0]).toMatchObject({ status: 'RESOLVED' });
  });

  it('para o relógio da fila junto', async () => {
    // Encerrada e "esperando resposta há 3h" ao mesmo tempo seria a mesma
    // contradição de novo, só que na fila de atendimento.
    const { aplicar, atualizacoes } = montar();

    await aplicar(ENCERROU);

    expect(atualizacoes[0].waitingSince).toBeNull();
  });

  it('deixa uma nota no histórico: a conversa mudou de estado sozinha', async () => {
    const { aplicar, notas } = montar();

    await aplicar(ENCERROU);

    expect(notas[0]).toMatchObject({ senderType: 'SYSTEM' });
    expect(String(notas[0].content)).toContain('encerrado pela IA');
  });

  it('não repete a mensagem de despedida pro cliente', async () => {
    // A IA já se despediu com as próprias palavras. O texto padrão de
    // encerramento logo em seguida seria a segunda despedida seguida.
    const { aplicar, notas } = montar();

    await aplicar(ENCERROU);

    expect(notas).toHaveLength(1);
    expect(notas[0].senderType).toBe('SYSTEM');
  });
});

describe('quando encerrar seria errado', () => {
  it('conversa que já tem dono não encerra', async () => {
    // Encerrar aqui tiraria da mesa de alguém um caso que essa pessoa
    // assumiu.
    const { aplicar, atualizacoes } = montar({ assignedUserId: 'user-1' });

    await aplicar(ENCERROU);

    expect(atualizacoes).toHaveLength(0);
  });

  it('conversa esperando atendente não encerra', async () => {
    // É o caso da IA transferir e se despedir no mesmo fôlego: o cliente
    // sai satisfeito, mas alguém ainda precisa pegar o caso.
    const { aplicar, atualizacoes } = montar({ status: 'WAITING_AGENT' });

    await aplicar(ENCERROU);

    expect(atualizacoes).toHaveLength(0);
  });

  it('conversa já resolvida não encerra de novo', async () => {
    const { aplicar, atualizacoes, notas } = montar({ status: 'RESOLVED' });

    await aplicar(ENCERROU);

    expect(atualizacoes).toHaveLength(0);
    expect(notas).toHaveLength(0);
  });
});
