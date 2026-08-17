import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TranscricaoService } from './transcricao.service';

/**
 * O que se testa aqui é dinheiro e privacidade, nesta ordem.
 *
 * Cada transcrição é uma chamada paga ao modelo, então "não transcrever de
 * novo o que já está transcrito" e "não transcrever quando o dono
 * desligou" não são detalhes de comportamento: são a conta do fim do mês.
 * E áudio apagado que volta em texto seria pior do que não ter o recurso.
 */
function montar(
  opcoes: {
    mensagem?: Record<string, unknown> | null;
    configuracao?: string;
    texto?: string | null;
    semChave?: boolean;
    downloadFalha?: boolean;
  } = {},
) {
  const update = jest.fn().mockResolvedValue({});
  const transcribe = jest.fn().mockResolvedValue(
    opcoes.texto === undefined ? 'bom dia, queria saber o horário' : opcoes.texto,
  );
  const emitToTenant = jest.fn();
  const download = opcoes.downloadFalha
    ? jest.fn().mockRejectedValue(new Error('404'))
    : jest.fn().mockResolvedValue({
        buffer: Buffer.from('audio'),
        mimeType: 'audio/ogg',
      });

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      message: {
        findFirst: jest.fn().mockImplementation((args: { where: { conversationId?: string } }) => {
          const mensagem =
            opcoes.mensagem === undefined
              ? {
                  id: 'msg-1',
                  conversationId: 'conversa-1',
                  messageType: 'AUDIO',
                  mediaId: 'midia-1',
                  transcricao: null,
                  deletedAt: null,
                  metadata: {},
                }
              : opcoes.mensagem;
          // A conferência de dono da conversa usa o mesmo findFirst.
          if (args.where.conversationId && mensagem) {
            return mensagem.conversationId === args.where.conversationId
              ? mensagem
              : null;
          }
          return mensagem;
        }),
        update,
      },
      inboxSettings: {
        findFirst: jest.fn().mockResolvedValue({
          transcricaoDeAudio: opcoes.configuracao ?? 'SOB_DEMANDA',
        }),
      },
    },
  };

  const service = new TranscricaoService(
    prisma as never,
    {
      resolve: jest.fn().mockResolvedValue({
        credentials: opcoes.semChave ? null : { apiKey: 'chave', model: 'x' },
      }),
    } as never,
    { download } as never,
    { emitToTenant } as never,
    { transcribe } as never,
  );

  return { service, transcribe, update, emitToTenant, download };
}

describe('transcrição de áudio', () => {
  it('transcreve, guarda e avisa a tela', async () => {
    const { service, update, emitToTenant } = montar();

    const texto = await service.transcrever('msg-1');

    expect(texto).toBe('bom dia, queria saber o horário');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { transcricao: 'bom dia, queria saber o horário' },
    });
    expect(emitToTenant).toHaveBeenCalledWith('tenant-teste', 'message.transcrita', {
      conversationId: 'conversa-1',
      messageId: 'msg-1',
      transcricao: 'bom dia, queria saber o horário',
    });
  });

  it('não paga duas vezes pelo mesmo áudio', async () => {
    const { service, transcribe, update } = montar({
      mensagem: {
        id: 'msg-1',
        conversationId: 'conversa-1',
        messageType: 'AUDIO',
        mediaId: 'midia-1',
        transcricao: 'já transcrito antes',
        deletedAt: null,
        metadata: {},
      },
    });

    await expect(service.transcrever('msg-1')).resolves.toBe('já transcrito antes');
    expect(transcribe).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('não recria em texto o áudio que alguém apagou', async () => {
    const { service, transcribe } = montar({
      mensagem: {
        id: 'msg-1',
        conversationId: 'conversa-1',
        messageType: 'AUDIO',
        mediaId: 'midia-1',
        transcricao: null,
        deletedAt: new Date(),
        metadata: {},
      },
    });

    await expect(service.transcrever('msg-1')).resolves.toBeNull();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('devolve null sem lançar quando o arquivo não baixa', async () => {
    const { service, transcribe } = montar({ downloadFalha: true });

    await expect(service.transcrever('msg-1')).resolves.toBeNull();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('devolve null sem lançar quando não há chave de IA', async () => {
    const { service, transcribe } = montar({ semChave: true });

    await expect(service.transcrever('msg-1')).resolves.toBeNull();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('não grava nem avisa quando o modelo não devolve texto', async () => {
    const { service, update, emitToTenant } = montar({ texto: null });

    await expect(service.transcrever('msg-1')).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(emitToTenant).not.toHaveBeenCalled();
  });
});

describe('a escolha do dono', () => {
  it('no automático, transcreve sozinho na chegada', async () => {
    const { service, transcribe } = montar({ configuracao: 'AUTOMATICA' });

    await service.transcreverSeAutomatico('msg-1');

    expect(transcribe).toHaveBeenCalled();
  });

  it('em sob demanda, a chegada não gasta nada', async () => {
    const { service, transcribe } = montar({ configuracao: 'SOB_DEMANDA' });

    await service.transcreverSeAutomatico('msg-1');

    expect(transcribe).not.toHaveBeenCalled();
  });

  it('desligada, o servidor recusa o pedido do atendente', async () => {
    const { service, transcribe } = montar({ configuracao: 'DESLIGADA' });

    await expect(
      service.transcreverAPedido('conversa-1', 'msg-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('recusa mensagem de outra conversa', async () => {
    const { service, transcribe } = montar();

    await expect(
      service.transcreverAPedido('conversa-2', 'msg-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('a pedido, devolve o texto', async () => {
    const { service } = montar();

    await expect(
      service.transcreverAPedido('conversa-1', 'msg-1'),
    ).resolves.toEqual({ transcricao: 'bom dia, queria saber o horário' });
  });

  it('a pedido, explica quando não deu', async () => {
    const { service } = montar({ texto: null });

    const resultado = await service.transcreverAPedido('conversa-1', 'msg-1');

    expect(resultado.transcricao).toBeNull();
    expect(resultado.motivo).toBeTruthy();
  });
});
