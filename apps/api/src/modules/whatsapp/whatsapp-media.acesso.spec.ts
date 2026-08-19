import { NotFoundException } from '@nestjs/common';
import { WhatsappMediaService } from './whatsapp-media.service';

/**
 * Quem pode baixar o anexo.
 *
 * O identificador de mídia vai no endereço da imagem dentro do painel —
 * ele aparece no HTML, no histórico do navegador e em qualquer print. O
 * que impede alguém de trocar esse identificador pelo de outra empresa e
 * baixar o anexo dela é esta conferência, e não a sorte de o provedor
 * recusar.
 */
function montar(dona: Record<string, unknown> | null) {
  const prisma = {
    tenantId: 'tenant-1',
    db: { message: { findFirst: jest.fn().mockResolvedValue(dona) } },
  };
  const storage = { ligado: false, buscar: jest.fn() };
  const evolution = { baixarMidia: jest.fn() };
  const global = {
    client: {
      tenant: { findUnique: jest.fn().mockResolvedValue({ canal: 'EVOLUTION' }) },
    },
  };

  const service = new WhatsappMediaService(
    prisma as never,
    global as never,
    {} as never,
    storage as never,
    evolution as never,
  );

  return { service, evolution };
}

describe('baixar anexo', () => {
  it('recusa o anexo que não é desta empresa, sem sair pedindo por aí', async () => {
    // A busca já é isolada por empresa: "não achei" aqui é ou um id que
    // não existe, ou um id de outro painel. Nos dois casos a resposta é a
    // mesma, e nenhuma chamada sai daqui.
    const { service, evolution } = montar(null);

    await expect(service.download('mídia-de-outra-empresa')).rejects.toThrow(
      NotFoundException,
    );
    expect(evolution.baixarMidia).not.toHaveBeenCalled();
  });

  it('recusa o anexo de mensagem apagada', async () => {
    // Apagar pela metade não é apagar: o balão some da tela e o arquivo
    // continua acessível por quem guardou o endereço.
    const { service } = montar({
      id: 'msg-1',
      metadata: {},
      deletedAt: new Date(),
    });

    await expect(service.download('mídia-1')).rejects.toThrow(NotFoundException);
  });

  it('manda o endereço guardado junto ao pedir o arquivo', async () => {
    const { service, evolution } = montar({
      id: 'msg-1',
      deletedAt: null,
      metadata: { evolutionMedia: { imageMessage: { url: 'wa://x' } } },
    });
    evolution.baixarMidia.mockResolvedValue({
      buffer: Buffer.from('foto'),
      mimeType: 'image/jpeg',
    });

    await service.download('mídia-1');

    expect(evolution.baixarMidia).toHaveBeenCalledWith('mídia-1', {
      imageMessage: { url: 'wa://x' },
    });
  });
});
