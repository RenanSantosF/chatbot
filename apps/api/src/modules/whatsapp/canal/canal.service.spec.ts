import { CanalService } from './canal.service';
import type { EvolutionCanal } from './evolution/evolution.canal';
import type { WhatsappSenderService } from '../whatsapp-sender.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { TenantPrismaService } from '../../../common/prisma/tenant-prisma.service';

/**
 * O que estes testes protegem.
 *
 * A camada de canal não envia nada — ela ESCOLHE quem envia. O defeito que
 * ela pode ter é silencioso e caro: mandar pela Meta uma mensagem de empresa
 * que escolheu outro provedor (cobrança indevida, número errado no aparelho
 * do cliente) ou, pior, dizer que enviou quando ninguém enviou.
 *
 * Por isso os casos aqui são sobre roteamento e sobre a honestidade da
 * falha, e não sobre o conteúdo da mensagem — aquilo é assunto de quem
 * implementa.
 */
function montar(provider: 'META_CLOUD' | 'EVOLUTION' | null) {
  const meta = {
    enviarTexto: jest.fn().mockResolvedValue('wamid.OK'),
    enviarReacao: jest.fn().mockResolvedValue(undefined),
    marcarComoLida: jest.fn().mockResolvedValue(undefined),
    listarModelos: jest.fn().mockResolvedValue([]),
    enviarModelo: jest.fn().mockResolvedValue('wamid.MODELO'),
    sendMedia: jest.fn().mockResolvedValue('wamid.MIDIA'),
    enviarMidia: jest
      .fn()
      .mockResolvedValue({ externalId: 'wamid.MIDIA', handle: 'media-1' }),
    baixarMidia: jest.fn().mockResolvedValue({
      buffer: Buffer.from('bin'),
      mimeType: 'image/png',
    }),
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
      .mockResolvedValue({ externalId: 'jid|1|EVO', handle: 'jid|1|EVO' }),
    baixarMidia: jest.fn().mockResolvedValue({
      buffer: Buffer.from('bin'),
      mimeType: 'image/jpeg',
    }),
    motivoDaUltimaFalha: null as string | null,
  };

  const prisma = { tenantId: 'tenant-1', db: {} };
  const global = {
    client: {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue(provider ? { canal: provider } : null),
      },
    },
  };

  const service = new CanalService(
    prisma as unknown as TenantPrismaService,
    global as unknown as PrismaService,
    meta as unknown as WhatsappSenderService,
    evolution as unknown as EvolutionCanal,
  );

  return { service, meta, evolution, global };
}

describe('escolha do provedor', () => {
  it('usa a Meta quando a empresa está no provedor oficial', async () => {
    const { service, meta } = montar('META_CLOUD');

    const id = await service.enviarTexto('5511999', 'oi', null);

    expect(id).toBe('wamid.OK');
    expect(meta.enviarTexto).toHaveBeenCalledWith('5511999', 'oi', null);
  });

  it('usa a Meta quando a empresa ainda não configurou nada', async () => {
    // Era o comportamento antes de existir escolha, e é o que devolve a
    // mensagem de "não conectado" que o painel sabe mostrar.
    const { service, meta } = montar(null);

    await service.enviarTexto('5511999', 'oi');

    expect(meta.enviarTexto).toHaveBeenCalled();
  });

  it('não encosta na Meta quando a empresa está na Evolution', async () => {
    // O caso perigoso: entregar em silêncio pelo canal errado gastaria
    // conversa paga da Meta numa empresa que pediu outro caminho.
    const { service, meta, evolution } = montar('EVOLUTION');

    const id = await service.enviarTexto('5511999', 'oi');

    expect(id).toBe('jid|1|EVO');
    expect(evolution.enviarTexto).toHaveBeenCalled();
    expect(meta.enviarTexto).not.toHaveBeenCalled();
  });

  it('lê o provedor a cada envio, e não uma vez só', async () => {
    // A empresa pode trocar de provedor sem ninguém reiniciar o servidor.
    const { service, global } = montar('META_CLOUD');

    await service.enviarTexto('5511999', 'a');
    await service.enviarTexto('5511999', 'b');

    expect(global.client.tenant.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('anexo', () => {
  const foto = {
    buffer: Buffer.from('bin'),
    mimetype: 'image/png',
    filename: 'foto.png',
    tipo: 'image' as const,
  };

  it('vai pela Evolution quando é dela que a empresa é', async () => {
    // Antes este caminho era recusado: o anexo só sabia falar com a Meta,
    // e uma empresa conectada por QR code recebia "não está disponível
    // nesta conexão" ao tentar mandar uma foto.
    const { service, meta, evolution } = montar('EVOLUTION');

    const envio = await service.enviarMidia('5511999', foto);

    expect(envio.externalId).toBe('jid|1|EVO');
    expect(evolution.enviarMidia).toHaveBeenCalled();
    expect(meta.enviarMidia).not.toHaveBeenCalled();
  });

  it('vai pela Meta quando a empresa está no oficial', async () => {
    const { service, meta, evolution } = montar('META_CLOUD');

    const envio = await service.enviarMidia('5511999', foto);

    expect(envio.handle).toBe('media-1');
    expect(meta.enviarMidia).toHaveBeenCalled();
    expect(evolution.enviarMidia).not.toHaveBeenCalled();
  });

  it('busca o binário no provedor de HOJE', async () => {
    // O handle guardado só faz sentido pra quem o criou: um `mediaId` da
    // Meta não quer dizer nada pra Evolution, e vice-versa.
    const { service, evolution } = montar('EVOLUTION');

    await service.baixarMidia('jid|1|EVO');

    expect(evolution.baixarMidia).toHaveBeenCalledWith('jid|1|EVO');
  });
});

describe('motivo da falha', () => {
  it('repassa o motivo de quem tentou entregar', async () => {
    const { service, meta } = montar('META_CLOUD');
    meta.enviarTexto.mockResolvedValue(null);
    meta.motivoDaUltimaFalha = 'o WhatsApp não está conectado nesta empresa';

    await service.enviarTexto('5511999', 'oi');

    expect(service.motivoDaUltimaFalha).toBe(
      'o WhatsApp não está conectado nesta empresa',
    );
  });

  it('não mostra o motivo da Meta quando quem recusou foi outro provedor', async () => {
    // Sem o controle de "quem foi usado por último", uma empresa na
    // Evolution veria no balão um erro guardado por um serviço que nem
    // chegou a ser chamado.
    const { service, meta, evolution } = montar('EVOLUTION');
    meta.motivoDaUltimaFalha = 'a Meta recusou o envio';
    evolution.motivoDaUltimaFalha = 'o WhatsApp desta empresa está desconectado';

    await service.enviarTexto('5511999', 'oi');

    expect(service.motivoDaUltimaFalha).toBe(
      'o WhatsApp desta empresa está desconectado',
    );
  });
});

describe('modelo aprovado', () => {
  it('propaga o erro quando o provedor não tem modelo', async () => {
    // Diferente do texto, iniciar conversa precisa falhar na cara de quem
    // clicou: ficar olhando pra uma conversa vazia é pior que ver o erro.
    const { service } = montar('EVOLUTION');

    await expect(
      service.enviarModelo('5511999', { name: 'ola', language: 'pt_BR' }),
    ).rejects.toThrow();
  });

  it('devolve lista vazia em vez de quebrar a tela', async () => {
    const { service } = montar('EVOLUTION');

    await expect(service.listarModelos()).resolves.toEqual([]);
  });
});
