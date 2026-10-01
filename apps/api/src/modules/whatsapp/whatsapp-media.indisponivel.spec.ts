import { NotFoundException } from '@nestjs/common';
import {
  WhatsappMediaService,
  midiaIndisponivel,
} from './whatsapp-media.service';

/**
 * O arquivo que o WhatsApp já apagou não é procurado de novo.
 *
 * O relato: abrir a galeria de uma conversa antiga deixava o painel lento —
 * cada miniatura de arquivo que não existe mais refazia a busca na
 * Evolution, e cada busca podia ficar pendurada até o tempo limite.
 */
function montar(
  metadata: Record<string, unknown>,
  evolucao: (
    handle: string,
    pista: unknown,
    aoFalhar?: (definitiva: boolean) => void,
  ) => Promise<unknown>,
  tenantId = 'tenant-1',
) {
  const update = jest.fn().mockResolvedValue({});
  const prisma = {
    tenantId,
    db: {
      message: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'msg-1', metadata, deletedAt: null }),
        update,
      },
    },
  };
  const evolution = { baixarMidia: jest.fn(evolucao) };
  const service = new WhatsappMediaService(
    prisma as never,
    {
      client: {
        tenant: {
          findUnique: jest.fn().mockResolvedValue({ canal: 'EVOLUTION' }),
        },
      },
    } as never,
    {} as never,
    { ligado: false, buscar: jest.fn() } as never,
    evolution as never,
  );
  return { service, evolution, update };
}

describe('anexo que o WhatsApp não tem mais', () => {
  it('quando a Evolution responde que não tem, a mensagem fica marcada', async () => {
    const { service, update } = montar({}, (_h, _p, aoFalhar) => {
      aoFalhar?.(true);
      return Promise.resolve(null);
    });

    await expect(service.download('m-1')).rejects.toThrow(NotFoundException);
    const [[{ data }]] = update.mock.calls as [
      [{ data: { metadata: { midiaIndisponivelEm: string } } }],
    ];
    expect(typeof data.metadata.midiaIndisponivelEm).toBe('string');
  });

  it('marcada, nem pergunta de novo', async () => {
    const { service, evolution } = montar(
      { midiaIndisponivelEm: new Date().toISOString() },
      () => Promise.resolve(null),
    );

    await expect(service.download('m-1')).rejects.toThrow(
      /não tem mais este arquivo/,
    );
    expect(evolution.baixarMidia).not.toHaveBeenCalled();
  });

  it('falha de rede não marca a mensagem, mas segura novas tentativas por um tempo', async () => {
    const { service, evolution, update } = montar(
      {},
      (_h, _p, aoFalhar) => {
        aoFalhar?.(false);
        return Promise.resolve(null);
      },
      'tenant-rede',
    );

    await expect(service.download('m-rede')).rejects.toThrow(NotFoundException);
    await expect(service.download('m-rede')).rejects.toThrow(NotFoundException);

    expect(update).not.toHaveBeenCalled();
    expect(evolution.baixarMidia).toHaveBeenCalledTimes(1);
  });

  it('a marca vence em uma semana — um engano se corrige sozinho', () => {
    const oitoDiasAtras = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(midiaIndisponivel({ midiaIndisponivelEm: oitoDiasAtras })).toBe(
      false,
    );
    expect(
      midiaIndisponivel({ midiaIndisponivelEm: new Date().toISOString() }),
    ).toBe(true);
  });
});
