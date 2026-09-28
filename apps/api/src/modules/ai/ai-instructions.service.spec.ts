import { AiInstructionsService } from './ai-instructions.service';
import {
  LIMITE_DE_REGRAS_ATIVAS,
  ORCAMENTO_DAS_REGRAS,
  regrasNoOrcamento,
} from './ai-context';

/**
 * O teto das regras — vão inteiras em toda resposta da IA, então cada
 * caractere a mais é pago milhares de vezes por mês.
 */
const regra = (tamanho: number, title = 'Regra') => ({
  title,
  content: 'x'.repeat(tamanho),
});

describe('regrasNoOrcamento', () => {
  it('pula a regra que não cabe inteira, mas mantém as curtas depois dela', () => {
    const regras = [
      regra(ORCAMENTO_DAS_REGRAS - 100, 'A'),
      regra(500, 'B'),
      regra(50, 'C'),
    ];
    const { cabem, ficaramDeFora } = regrasNoOrcamento(regras);
    expect(cabem.map((r) => r.title)).toEqual(['A', 'C']);
    expect(ficaramDeFora).toBe(1);
  });

  it('não passa do número máximo de regras', () => {
    const muitas = Array.from({ length: LIMITE_DE_REGRAS_ATIVAS + 5 }, () =>
      regra(10),
    );
    expect(regrasNoOrcamento(muitas).cabem).toHaveLength(
      LIMITE_DE_REGRAS_ATIVAS,
    );
  });
});

describe('AiInstructionsService — teto no cadastro', () => {
  function montar(
    ativas: { title: string; content: string }[],
    atual?: object,
  ) {
    const prisma = {
      tenantId: 't1',
      db: {
        aiInstruction: {
          findMany: jest.fn().mockResolvedValue(ativas),
          findFirst: jest.fn().mockResolvedValue(atual ?? null),
          create: jest.fn().mockResolvedValue({ id: 'nova' }),
          update: jest.fn().mockResolvedValue({ id: 'r1' }),
        },
      },
    };
    return {
      service: new AiInstructionsService(prisma as never),
      prisma,
    };
  }

  it('aceita a regra que cabe', async () => {
    const { service, prisma } = montar([regra(100)]);
    await service.create({ title: 'Nova', content: 'curta' });
    expect(prisma.db.aiInstruction.create).toHaveBeenCalled();
  });

  it('recusa a regra que passaria do orçamento de caracteres', async () => {
    const { service, prisma } = montar([regra(ORCAMENTO_DAS_REGRAS - 20)]);
    await expect(
      service.create({ title: 'Nova', content: 'x'.repeat(100) }),
    ).rejects.toThrow(/passariam de/);
    expect(prisma.db.aiInstruction.create).not.toHaveBeenCalled();
  });

  it('recusa a regra além do número máximo de ativas', async () => {
    const ativas = Array.from({ length: LIMITE_DE_REGRAS_ATIVAS }, () =>
      regra(5),
    );
    const { service } = montar(ativas);
    await expect(
      service.create({ title: 'Nova', content: 'ok' }),
    ).rejects.toThrow(/o máximo/);
  });

  it('desativar nunca é barrado, mesmo acima do teto', async () => {
    const { service, prisma } = montar([regra(ORCAMENTO_DAS_REGRAS)], {
      id: 'r1',
      active: true,
      ...regra(ORCAMENTO_DAS_REGRAS),
    });
    await service.update('r1', { active: false });
    expect(prisma.db.aiInstruction.findMany).not.toHaveBeenCalled();
    expect(prisma.db.aiInstruction.update).toHaveBeenCalled();
  });

  it('reativar confere o orçamento', async () => {
    const { service } = montar([regra(ORCAMENTO_DAS_REGRAS - 10)], {
      id: 'r1',
      active: false,
      ...regra(100),
    });
    await expect(service.update('r1', { active: true })).rejects.toThrow(
      /passariam de/,
    );
  });
});
