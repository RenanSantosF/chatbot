import { CanalService } from './canal.service';
import type { EvolutionCanal } from './evolution/evolution.canal';
import type { WhatsappSenderService } from '../whatsapp-sender.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { TenantPrismaService } from '../../../common/prisma/tenant-prisma.service';

/**
 * O que estes testes protegem.
 *
 * A camada de canal não envia nada — ela decide QUEM envia. Desde que o
 * produto passou a ter um provedor só, a decisão deixou de ser uma
 * escolha e virou uma garantia: nenhuma mensagem pode encontrar o caminho
 * oficial, nem por engano, nem por um campo desatualizado no banco.
 *
 * Era exatamente esse engano que acontecia. A empresa tinha o aparelho
 * vinculado e funcionando, a tela dizia "Conectado", o que chegava
 * entrava pelo webhook — e só o ENVIO caía no provedor oficial, que não
 * tem credencial nenhuma e recusava. Tudo parecia certo menos a única
 * coisa que importava.
 */
function montar() {
  const meta = {
    enviarTexto: jest.fn().mockResolvedValue('wamid.OK'),
    enviarReacao: jest.fn().mockResolvedValue(undefined),
    marcarComoLida: jest.fn().mockResolvedValue(undefined),
    listarModelos: jest.fn().mockResolvedValue([]),
    enviarModelo: jest.fn().mockResolvedValue('wamid.MODELO'),
    enviarMidia: jest.fn().mockResolvedValue({ externalId: 'x', handle: 'y' }),
    baixarMidia: jest.fn().mockResolvedValue(null),
    motivoDaUltimaFalha: null as string | null,
  };

  const evolution = {
    enviarTexto: jest.fn().mockResolvedValue('jid|1|EVO'),
    enviarReacao: jest.fn().mockResolvedValue(undefined),
    marcarComoLida: jest.fn().mockResolvedValue(undefined),
    listarModelos: jest.fn().mockResolvedValue([]),
    enviarModelo: jest.fn().mockRejectedValue(new Error('sem modelo aqui')),
    enviarMidia: jest
      .fn()
      .mockResolvedValue({ externalId: 'jid|1|MIDIA', handle: 'jid|0|MIDIA' }),
    baixarMidia: jest.fn().mockResolvedValue({ buffer: Buffer.from(''), mimeType: '' }),
    motivoDaUltimaFalha: null as string | null,
  };

  const prisma = { tenantId: 'tenant-1', db: {} };
  const global = { client: { tenant: { findUnique: jest.fn(), update: jest.fn() } } };

  const service = new CanalService(
    prisma as unknown as TenantPrismaService,
    global as unknown as PrismaService,
    meta as unknown as WhatsappSenderService,
    evolution as unknown as EvolutionCanal,
  );

  return { service, meta, evolution, global };
}

describe('quem entrega', () => {
  it('é sempre a Evolution', async () => {
    const { service, meta, evolution } = montar();

    expect(await service.enviarTexto('5511999', 'oi', null)).toBe('jid|1|EVO');
    expect(evolution.enviarTexto).toHaveBeenCalledWith('5511999', 'oi', null);
    expect(meta.enviarTexto).not.toHaveBeenCalled();
  });

  it('não consulta o banco pra decidir', async () => {
    // A decisão não depende mais de nenhum campo, e é isso que impede o
    // caso em que a tela mostra "Conectado" e o envio vai pro outro lado
    // porque uma linha ficou pra trás.
    const { service, global } = montar();

    await service.enviarTexto('5511999', 'oi');

    expect(global.client.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('nunca encosta no serviço oficial, em nenhum método', async () => {
    const { service, meta, evolution } = montar();

    await service.enviarTexto('5511999', 'oi');
    await service.enviarReacao('5511999', 'jid|0|A', '👍');
    await service.marcarComoLida('jid|0|A');
    await service.listarModelos();
    await service.enviarMidia('5511999', {
      buffer: Buffer.from(''),
      mimetype: 'image/png',
      filename: 'a.png',
      tipo: 'image',
    });
    await service.baixarMidia('jid|0|A');
    await expect(
      service.enviarModelo('5511999', { name: 'ola', language: 'pt_BR' }),
    ).rejects.toThrow();

    for (const chamada of Object.values(meta)) {
      if (typeof chamada === 'function') expect(chamada).not.toHaveBeenCalled();
    }
    expect(evolution.enviarMidia).toHaveBeenCalled();
    expect(evolution.baixarMidia).toHaveBeenCalled();
  });
});

describe('motivo da falha', () => {
  it('repassa o motivo de quem tentou entregar', async () => {
    const { service, evolution } = montar();
    evolution.enviarTexto.mockResolvedValue(null);
    evolution.motivoDaUltimaFalha = 'o WhatsApp desta empresa está desconectado';

    await service.enviarTexto('5511999', 'oi');

    expect(service.motivoDaUltimaFalha).toBe(
      'o WhatsApp desta empresa está desconectado',
    );
  });

  it('não devolve o motivo guardado pelo serviço oficial', async () => {
    // Ele nunca é chamado, então um motivo antigo lá dentro só poderia
    // aparecer como mentira no balão de quem atende.
    const { service, meta } = montar();
    meta.motivoDaUltimaFalha = 'a Meta recusou o envio';

    expect(service.motivoDaUltimaFalha).not.toBe('a Meta recusou o envio');
  });
});

describe('modelo aprovado', () => {
  it('propaga o erro, porque não existe modelo neste caminho', async () => {
    // Diferente do texto, iniciar conversa precisa falhar na cara de quem
    // clicou: ficar olhando pra uma conversa vazia é pior que ver o erro.
    const { service } = montar();

    await expect(
      service.enviarModelo('5511999', { name: 'ola', language: 'pt_BR' }),
    ).rejects.toThrow();
  });

  it('devolve lista vazia em vez de quebrar a tela', async () => {
    await expect(montar().service.listarModelos()).resolves.toEqual([]);
  });
});
