import { ConflictException } from '@nestjs/common';
import { QuickRepliesService, normalizarAtalho } from './quick-replies.service';

/**
 * O atalho é o recurso inteiro.
 *
 * Uma resposta rápida que existe e não é encontrada quando a pessoa digita
 * é pior que não existir: ela cadastrou, confiou, e no meio do atendimento
 * o atalho não abre nada. Por isso a forma guardada é a forma digitada —
 * minúscula, sem acento e sem espaço.
 */
describe('normalizando o atalho', () => {
  it('quem cadastra escreve bonito, quem usa digita depressa', () => {
    expect(normalizarAtalho('Bom Dia')).toBe('bom-dia');
    expect(normalizarAtalho('/BOMDIA')).toBe('bomdia');
    expect(normalizarAtalho('  saudação  ')).toBe('saudacao');
  });

  it('a barra da frente não faz parte do atalho', () => {
    // No compositor a barra é o gatilho, não o nome. Guardá-la faria
    // "//bomdia" ser o que abre.
    expect(normalizarAtalho('///pix')).toBe('pix');
  });

  it('pontuação vira separador, e sobra não vira traço solto', () => {
    expect(normalizarAtalho('dados: bancários!')).toBe('dados-bancarios');
  });

  it('sem letra nem número, não sobra atalho nenhum', () => {
    expect(normalizarAtalho('///')).toBe('');
    expect(normalizarAtalho('   ')).toBe('');
  });
});

function servicoCom(existentes: { id: string; shortcut: string }[] = []) {
  const criadas: Record<string, unknown>[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      quickReply: {
        findMany: jest.fn().mockResolvedValue(existentes),
        findFirst: jest
          .fn()
          .mockImplementation((args: { where: Record<string, unknown> }) => {
            const { shortcut, id } = args.where as {
              shortcut?: string;
              id?: string | { not: string };
            };
            if (typeof id === 'string') {
              return existentes.find((item) => item.id === id) ?? null;
            }
            const excluido = typeof id === 'object' ? id.not : null;
            return (
              existentes.find(
                (item) =>
                  item.shortcut === shortcut && item.id !== excluido,
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
      },
    },
  };

  return { service: new QuickRepliesService(prisma as never), criadas, prisma };
}

describe('cadastrando', () => {
  it('guarda o atalho já na forma que se digita', async () => {
    const { service, criadas } = servicoCom();

    await service.create({ shortcut: '/Bom Dia', content: 'Bom dia!' });

    expect(criadas[0].shortcut).toBe('bom-dia');
  });

  it('atalho repetido é recusado com o nome do conflito', async () => {
    // Dois atalhos iguais deixariam a escolha no ar: quem digita "/pix"
    // não teria como saber qual dos dois vem.
    const { service } = servicoCom([{ id: 'r1', shortcut: 'pix' }]);

    await expect(
      service.create({ shortcut: 'PIX', content: 'Chave: ...' }),
    ).rejects.toThrow(ConflictException);
  });

  it('atalho só de pontuação não vira resposta', async () => {
    const { service } = servicoCom();

    await expect(
      service.create({ shortcut: '///', content: 'texto' }),
    ).rejects.toThrow(ConflictException);
  });

  it('título em branco vira nulo, não string vazia', async () => {
    // A lista usa a primeira linha do texto quando não há título; um "" no
    // banco faria a linha aparecer sem rótulo nenhum.
    const { service, criadas } = servicoCom();

    await service.create({ shortcut: 'oi', title: '   ', content: 'Olá!' });

    expect(criadas[0].title).toBeNull();
  });
});

describe('editando', () => {
  it('manter o próprio atalho não conta como conflito', async () => {
    // Sem a exclusão do próprio id, trocar só o texto de uma resposta
    // reclamaria que o atalho dela já existe — e ela mesma seria a culpada.
    const { service } = servicoCom([{ id: 'r1', shortcut: 'pix' }]);

    await expect(
      service.update('r1', { shortcut: 'pix', content: 'Nova chave' }),
    ).resolves.toMatchObject({ content: 'Nova chave' });
  });

  it('roubar o atalho de outra é recusado', async () => {
    const { service } = servicoCom([
      { id: 'r1', shortcut: 'pix' },
      { id: 'r2', shortcut: 'bomdia' },
    ]);

    await expect(
      service.update('r2', { shortcut: 'pix' }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('a lista', () => {
  it('vem pelas mais usadas', async () => {
    // Depois de uma semana o atalho certo é o primeiro, sem ninguém ter
    // organizado nada.
    const { service, prisma } = servicoCom();

    await service.list();

    expect(prisma.db.quickReply.findMany).toHaveBeenCalledWith({
      orderBy: [{ usageCount: 'desc' }, { shortcut: 'asc' }],
    });
  });
});
