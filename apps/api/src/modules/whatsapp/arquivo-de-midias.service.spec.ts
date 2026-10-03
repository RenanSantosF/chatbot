import { Injectable } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { ArquivoDeMidiasService } from './arquivo-de-midias.service';

const AGORA = new Date('2026-10-05T12:00:00Z');
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3600_000);

function montar(opcoes: {
  linhas: { mediaId: string; metadata?: Record<string, unknown> }[];
  usado?: number;
  storageLigado?: boolean;
}) {
  const prisma = {
    client: {
      tenant: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tenant-1',
            billing: {
              usedBytes: BigInt(opcoes.usado ?? 0),
              quotaBytes: BigInt(100),
            },
          },
        ]),
      },
      message: {
        findMany: jest.fn().mockResolvedValue(
          opcoes.linhas.map((linha, i) => ({
            mediaId: linha.mediaId,
            metadata: linha.metadata ?? {},
            createdAt: horasAtras(i + 1),
          })),
        ),
      },
    },
  };
  const midias = { arquivar: jest.fn().mockResolvedValue(undefined) };
  const moduleRef = {
    registerRequestByContextId: jest.fn(),
    resolve: jest.fn().mockResolvedValue(midias),
  };
  const service = new ArquivoDeMidiasService(
    prisma as never,
    { ligado: opcoes.storageLigado ?? true } as never,
    moduleRef as never,
  );
  return { service, prisma, midias, moduleRef };
}

describe('arquivamento das mídias em segundo plano', () => {
  it('guarda o que ainda não tem cópia, como a empresa dona', async () => {
    const { service, midias, moduleRef } = montar({
      linhas: [
        { mediaId: 'm1', metadata: { fileName: 'nota.pdf' } },
        { mediaId: 'm2', metadata: { storageKey: 'ja/guardada' } },
      ],
    });

    await service.arquivar(AGORA);

    expect(moduleRef.registerRequestByContextId).toHaveBeenCalledWith(
      { user: { tenantId: 'tenant-1' } },
      expect.anything(),
    );
    expect(midias.arquivar).toHaveBeenCalledTimes(1);
    expect(midias.arquivar).toHaveBeenCalledWith('m1', 'nota.pdf');
  });

  it('não insiste no que o WhatsApp já apagou', async () => {
    const { service, midias } = montar({
      linhas: [
        { mediaId: 'm1', metadata: { midiaIndisponivelEm: '2026-10-01' } },
      ],
    });

    await service.arquivar(AGORA);

    expect(midias.arquivar).not.toHaveBeenCalled();
  });

  it('com o espaço da empresa quase cheio, não guarda o passado', async () => {
    // Guardar empurraria a conta pro limite, e a retenção apagaria
    // conversas antigas pra caber.
    const { service, midias } = montar({
      linhas: [{ mediaId: 'm1' }],
      usado: 80,
    });

    await service.arquivar(AGORA);

    expect(midias.arquivar).not.toHaveBeenCalled();
  });

  it('sem armazenamento configurado, não faz nada', async () => {
    const { service, prisma } = montar({
      linhas: [{ mediaId: 'm1' }],
      storageLigado: false,
    });

    await service.arquivar(AGORA);

    expect(prisma.client.tenant.findMany).not.toHaveBeenCalled();
  });

  it('devagar: no máximo 25 por empresa a cada passada', async () => {
    const { service, midias } = montar({
      linhas: Array.from({ length: 60 }, (_, i) => ({ mediaId: `m${i}` })),
    });

    await service.arquivar(AGORA);

    expect(midias.arquivar).toHaveBeenCalledTimes(25);
  });
});

/**
 * O truque que as rotinas em segundo plano usam pra chamar serviços de
 * escopo de requisição: um contexto com o tenant certo. Se ele parar de
 * funcionar (mudança no Nest), o arquivamento e o resumo semanal falham
 * calados — por isso o teste monta o Nest de verdade.
 */
describe('serviço da empresa fora de uma requisição', () => {
  @Injectable()
  class Leitor {
    constructor(readonly prisma: TenantPrismaService) {}
  }

  it('o TenantPrismaService enxerga o tenant do contexto', async () => {
    const modulo = await Test.createTestingModule({
      providers: [
        Leitor,
        TenantPrismaService,
        { provide: PrismaService, useValue: { client: {} } },
      ],
    }).compile();
    const moduleRef = modulo.get(ModuleRef);

    const contexto = ContextIdFactory.create();
    moduleRef.registerRequestByContextId(
      { user: { tenantId: 'tenant-7' } },
      contexto,
    );
    const leitor = await moduleRef.resolve(Leitor, contexto, {
      strict: false,
    });

    expect(leitor.prisma.tenantId).toBe('tenant-7');
  });
});
