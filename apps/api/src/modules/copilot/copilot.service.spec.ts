import { BadRequestException } from '@nestjs/common';
import { CopilotService } from './copilot.service';

/**
 * O assistente do painel é a própria tela.
 *
 * Quem pergunta aqui é o dono da empresa, e ele não tem acesso a log de
 * servidor nenhum. Uma exceção que sobe vira "500 Internal server error"
 * na cara dele — foi o defeito que este arquivo existe pra não deixar
 * voltar. Falha da IA tem que virar FRASE, sempre.
 */
function montar(
  opcoes: {
    /** O que o provedor faz quando chamado. */
    provedor?: (entrada: {
      executeTool: (nome: string, args: object) => Promise<unknown>;
    }) => Promise<{ content: string }>;
    semChave?: boolean;
  } = {},
) {
  const generateReply = jest
    .fn()
    .mockImplementation(
      opcoes.provedor ?? (async () => ({ content: 'A fila está tranquila.' })),
    );

  const service = new CopilotService(
    {
      tenantId: 'tenant-teste',
      db: {
        aiSettings: { findFirst: jest.fn().mockResolvedValue(null) },
        conversation: {
          groupBy: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
      },
    } as never,
    {
      resolve: jest.fn().mockResolvedValue({
        active: true,
        credentials: opcoes.semChave ? null : { apiKey: 'chave', model: 'x' },
      }),
    } as never,
    { get: jest.fn().mockResolvedValue({}), update: jest.fn() } as never,
    { generateReply } as never,
  );

  return { service, generateReply };
}

const perguntar = (service: CopilotService) =>
  service.ask([{ role: 'user' as const, content: 'Como está a fila hoje?' }]);

describe('o assistente do painel nunca devolve erro cru', () => {
  it('cota estourada vira a frase da cota, não uma exceção', async () => {
    const { service } = montar({
      provedor: async () => {
        throw new Error(
          '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}',
        );
      },
    });

    const resposta = await perguntar(service);

    expect(resposta.falhou).toBe(true);
    expect(resposta.content).toMatch(/limite de uso/i);
  });

  it('chave recusada aponta a tela onde se resolve', async () => {
    const { service } = montar({
      provedor: async () => {
        throw new Error(
          '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
        );
      },
    });

    const resposta = await perguntar(service);

    expect(resposta.falhou).toBe(true);
    expect(resposta.content).toContain('Configurações > IA');
  });

  it('demora do provedor vira convite a tentar de novo', async () => {
    const { service } = montar({
      provedor: async () => {
        throw new Error('O provedor de IA não respondeu em 25 segundos (copiloto).');
      },
    });

    const resposta = await perguntar(service);

    expect(resposta.falhou).toBe(true);
    expect(resposta.content).toMatch(/demorou demais/i);
  });

  it('falha sem assinatura conhecida ainda vira frase', async () => {
    const { service } = montar({
      provedor: async () => {
        throw new TypeError('cannot read properties of undefined');
      },
    });

    const resposta = await perguntar(service);

    expect(resposta.falhou).toBe(true);
    expect(resposta.content.length).toBeGreaterThan(20);
  });

  it('resposta boa passa limpa, sem marca de falha', async () => {
    const { service } = montar();

    const resposta = await perguntar(service);

    expect(resposta.content).toBe('A fila está tranquila.');
    expect(resposta.falhou).toBeUndefined();
  });
});

describe('o balão nunca sai vazio', () => {
  it('mudou a configuração e o modelo não escreveu nada: confirma a mudança', async () => {
    const { service } = montar({
      provedor: async ({ executeTool }) => {
        // O modelo chama a ferramenta e devolve texto vazio — o caso real
        // em que a alteração JÁ aconteceu.
        await executeTool('ajustarAtendimento', { sendReadReceipts: false });
        return { content: '   ' };
      },
    });

    const resposta = await service.ask([
      { role: 'user', content: 'desliga a confirmação de leitura' },
    ]);

    expect(resposta.content).toMatch(/ajustei/i);
  });

  it('sem ferramenta e sem texto: diz que não conseguiu, em vez de balão vazio', async () => {
    const { service } = montar({ provedor: async () => ({ content: '' }) });

    const resposta = await perguntar(service);

    expect(resposta.content.trim().length).toBeGreaterThan(0);
    expect(resposta.content).toMatch(/não consegui/i);
  });
});

describe('sem chave configurada', () => {
  it('continua sendo pedido inválido, não falha de IA', async () => {
    const { service } = montar({ semChave: true });

    await expect(perguntar(service)).rejects.toBeInstanceOf(BadRequestException);
  });
});
