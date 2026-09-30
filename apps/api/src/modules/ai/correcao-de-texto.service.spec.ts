import { HttpException } from '@nestjs/common';
import {
  CorrecaoDeTextoService,
  LIMITE_DE_CORRECOES_POR_MES,
  limpar,
} from './correcao-de-texto.service';

/**
 * O botão ✨: o texto do atendente volta corrigido pro campo, e a conta
 * paga uma fração de centavo por isso — com teto contra abuso.
 */
function montar(
  opcoes: { resposta?: string; usadas?: number; semChave?: boolean } = {},
) {
  const generateReply = jest.fn().mockResolvedValue({
    content: opcoes.resposta ?? 'Oi! Tudo bem? O orçamento sai amanhã.',
    usage: { inputTokens: 200, outputTokens: 40 },
  });
  const updateConta = jest.fn().mockResolvedValue({});
  const updateUsuario = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    db: {
      billingAccount: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conta',
          aiCorrecoesNoPeriodo: opcoes.usadas ?? 0,
        }),
        update: updateConta,
      },
      user: { updateMany: updateUsuario },
    },
  };
  const credenciais = {
    resolve: jest.fn().mockResolvedValue({
      active: true,
      credentials: opcoes.semChave ? null : { apiKey: 'k', model: 'm' },
    }),
  };
  const service = new CorrecaoDeTextoService(
    prisma as never,
    credenciais as never,
    { generateReply },
  );
  return { service, generateReply, updateConta, updateUsuario };
}

describe('correção de texto por IA', () => {
  it('devolve o texto corrigido e conta à parte das respostas', async () => {
    const { service, updateConta } = montar();

    const resposta = await service.corrigir(
      'oi tudo bem o orcamento sai amanha',
      'u1',
    );

    expect(resposta.texto).toBe('Oi! Tudo bem? O orçamento sai amanhã.');
    const [[{ data }]] = updateConta.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    expect(data).toMatchObject({ aiCorrecoesNoPeriodo: { increment: 1 } });
    expect(data).not.toHaveProperty('aiRepliesUsed');
  });

  it('pede revisão com raciocínio, sem variação e sem cortar o texto', async () => {
    // Sem pensar, o modelo deixava passar "os produtos tava".
    const { service, generateReply } = montar();

    await service.corrigir('os produto tava tudo caro', 'u1');

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        raciocinio: 'baixo',
        temperatura: 0,
        maximoDeSaida: expect.any(Number) as number,
      }),
    );
  });

  it('marca que a pessoa já usou, pra dica parar de aparecer', async () => {
    const { service, updateUsuario } = montar();

    await service.corrigir('oi', 'u1');

    expect(updateUsuario).toHaveBeenCalledWith({
      where: { id: 'u1', usouCorrecaoEm: null },
      data: { usouCorrecaoEm: expect.any(Date) as Date },
    });
  });

  it('no teto do mês, recusa sem chamar a IA', async () => {
    const { service, generateReply } = montar({
      usadas: LIMITE_DE_CORRECOES_POR_MES,
    });

    await expect(service.corrigir('oi', 'u1')).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(generateReply).not.toHaveBeenCalled();
  });

  it('resposta vazia da IA devolve o original, sem apagar o que foi escrito', async () => {
    const { service } = montar({ resposta: '   ' });

    const resposta = await service.corrigir('meu texto', 'u1');

    expect(resposta.texto).toBe('meu texto');
  });

  it('tira aspas e o "aqui está" que o modelo às vezes põe', () => {
    expect(limpar('"Oi, tudo bem?"')).toBe('Oi, tudo bem?');
    expect(limpar('Aqui está o texto corrigido: Oi!')).toBe('Oi!');
    expect(limpar('Texto corrigido: Pode ser.')).toBe('Pode ser.');
  });
});
