import { CanalService } from './canal.service';
import type { WhatsappSenderService } from '../whatsapp-sender.service';
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
    motivoDaUltimaFalha: null as string | null,
  };

  const prisma = {
    tenantId: 'tenant-1',
    db: {
      whatsAppSettings: {
        findFirst: jest.fn().mockResolvedValue(provider ? { provider } : null),
      },
    },
  };

  const service = new CanalService(
    prisma as unknown as TenantPrismaService,
    meta as unknown as WhatsappSenderService,
  );

  return { service, meta, prisma };
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

  it('não cai na Meta quando a empresa escolheu um provedor indisponível', async () => {
    // O caso perigoso: silenciosamente entregar pelo canal errado gastaria
    // conversa paga da Meta numa empresa que pediu outro caminho.
    const { service, meta } = montar('EVOLUTION');

    const id = await service.enviarTexto('5511999', 'oi');

    expect(id).toBeNull();
    expect(meta.enviarTexto).not.toHaveBeenCalled();
  });

  it('lê o provedor a cada envio, e não uma vez só', async () => {
    // A empresa pode trocar de provedor sem ninguém reiniciar o servidor.
    const { service, prisma } = montar('META_CLOUD');

    await service.enviarTexto('5511999', 'a');
    await service.enviarTexto('5511999', 'b');

    expect(prisma.db.whatsAppSettings.findFirst).toHaveBeenCalledTimes(2);
  });
});

describe('motivo da falha', () => {
  it('explica quando o provedor escolhido não está de pé', async () => {
    const { service } = montar('EVOLUTION');

    await service.enviarTexto('5511999', 'oi');

    expect(service.motivoDaUltimaFalha).toContain('ainda não está disponível');
  });

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
    const { service, meta } = montar('EVOLUTION');
    meta.motivoDaUltimaFalha = 'a Meta recusou o envio';

    await service.enviarTexto('5511999', 'oi');

    expect(service.motivoDaUltimaFalha).not.toBe('a Meta recusou o envio');
  });
});

describe('modelo aprovado', () => {
  it('propaga o erro quando o provedor não tem modelos', async () => {
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
