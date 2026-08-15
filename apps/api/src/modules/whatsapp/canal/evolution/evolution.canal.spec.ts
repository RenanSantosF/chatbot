import type { EncryptionService } from '../../../../common/crypto/encryption.service';
import type { TenantPrismaService } from '../../../../common/prisma/tenant-prisma.service';
import { EvolutionCanal } from './evolution.canal';
import { empacotarId } from './evolution-id';

/** O servidor Evolution de mentira. Nenhum teste encosta em rede. */
function servidor() {
  const chamadas: { url: string; corpo: unknown }[] = [];
  let resposta: { status: number; corpo: unknown } = {
    status: 200,
    corpo: { key: { remoteJid: '5511999@s.whatsapp.net', fromMe: true, id: 'EVO1' } },
  };

  global.fetch = jest.fn(async (url: unknown, init: unknown) => {
    const opcoes = init as { body?: string };
    chamadas.push({
      url: String(url),
      corpo: opcoes.body ? JSON.parse(opcoes.body) : undefined,
    });
    return {
      ok: resposta.status < 400,
      status: resposta.status,
      text: async () => JSON.stringify(resposta.corpo),
    } as Response;
  }) as unknown as typeof fetch;

  return {
    chamadas,
    responder(status: number, corpo: unknown) {
      resposta = { status, corpo };
    },
  };
}

function montar(config: Record<string, unknown> | null) {
  const prisma = {
    tenantId: 'tenant-1',
    db: {
      evolutionSettings: {
        findFirst: jest.fn().mockResolvedValue(
          config && {
            baseUrl: 'https://evo.exemplo.com',
            apiKeyEncrypted: 'cifrado',
            instance: 'inteliwa-1',
            estado: 'CONECTADO',
            ...config,
          },
        ),
      },
    },
  };
  const encryption = { decrypt: jest.fn().mockReturnValue('chave-crua') };

  return new EvolutionCanal(
    prisma as unknown as TenantPrismaService,
    encryption as unknown as EncryptionService,
  );
}

describe('envio de texto', () => {
  it('devolve a chave inteira, e não só o id', async () => {
    // A chave composta é o que permite reagir e marcar como lida depois:
    // na Evolution o id sozinho não localiza mensagem nenhuma.
    const rede = servidor();
    const canal = montar({});

    const id = await canal.enviarTexto('+55 (11) 99999', 'bom dia');

    expect(id).toBe('5511999@s.whatsapp.net|1|EVO1');
    expect(rede.chamadas[0].url).toContain('/message/sendText/inteliwa-1');
    expect(rede.chamadas[0].corpo).toMatchObject({
      number: '551199999',
      text: 'bom dia',
    });
  });

  it('não tenta enviar com a sessão caída, e diz o que fazer', async () => {
    // O erro que mais confunde: a mensagem sai do painel e some. Dizer
    // "desconectado" transforma isso numa ação — reconectar — em vez de
    // uma espera.
    servidor();
    const canal = montar({ estado: 'DESCONECTADO' });

    expect(await canal.enviarTexto('5511999', 'oi')).toBeNull();
    expect(canal.motivoDaUltimaFalha).toContain('desconectado');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('separa "aguardando QR code" de "desconectado"', async () => {
    servidor();
    const canal = montar({ estado: 'AGUARDANDO_QRCODE' });

    await canal.enviarTexto('5511999', 'oi');

    expect(canal.motivoDaUltimaFalha).toContain('QR code');
  });

  it('avisa quando a empresa nunca conectou', async () => {
    servidor();
    const canal = montar(null);

    expect(await canal.enviarTexto('5511999', 'oi')).toBeNull();
    expect(canal.motivoDaUltimaFalha).toContain('não está conectado');
  });

  it('guarda o motivo que o servidor deu', async () => {
    const rede = servidor();
    rede.responder(400, { message: 'number not exists' });
    const canal = montar({});

    expect(await canal.enviarTexto('5511999', 'oi')).toBeNull();
    expect(canal.motivoDaUltimaFalha).toBe('number not exists');
  });

  it('limpa o motivo antigo antes de tentar de novo', async () => {
    // Sem isto, uma mensagem que saiu depois de uma que falhou herdaria o
    // erro anterior e apareceria como falha no painel.
    const rede = servidor();
    const canal = montar({});
    rede.responder(400, { message: 'deu ruim' });
    await canal.enviarTexto('5511999', 'oi');

    rede.responder(200, { key: { remoteJid: 'x@s.whatsapp.net', id: 'EVO2' } });
    await canal.enviarTexto('5511999', 'oi de novo');

    expect(canal.motivoDaUltimaFalha).toBeNull();
  });

  it('cita mandando só o id, que é o que o servidor entende', async () => {
    const rede = servidor();
    const canal = montar({});

    await canal.enviarTexto(
      '5511999',
      'sobre isso',
      empacotarId({ remoteJid: '5511999@s.whatsapp.net', fromMe: false, id: 'ANTES' }),
    );

    expect(rede.chamadas[0].corpo).toMatchObject({
      quoted: { key: { id: 'ANTES' } },
    });
  });
});

describe('reação e leitura', () => {
  it('desmonta a chave composta pra reagir', async () => {
    const rede = servidor();
    const canal = montar({});

    await canal.enviarReacao(
      '5511999',
      empacotarId({ remoteJid: '5511999@s.whatsapp.net', fromMe: false, id: 'ALVO' }),
      '👍',
    );

    expect(rede.chamadas[0].corpo).toMatchObject({
      key: { id: 'ALVO', fromMe: false },
      reaction: '👍',
    });
  });

  it('ignora id de outro provedor sem quebrar', async () => {
    // Uma empresa que migrou da Meta tem wamid gravado nas linhas antigas.
    servidor();
    const canal = montar({});

    await canal.marcarComoLida('wamid.HBgNNTUxMQ==');

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('modelo aprovado', () => {
  it('devolve lista vazia pra tela esconder o recurso sozinha', async () => {
    // Modelo aprovado é regra da plataforma oficial, não do WhatsApp. Aqui
    // ele não existe, e a lista vazia é o que evita um `if` de provedor
    // dentro do painel.
    await expect(montar({}).listarModelos()).resolves.toEqual([]);
  });

  it('recusa em vez de mandar o texto do modelo como mensagem comum', async () => {
    // Quem escolheu um modelo esperava a proteção que ele dá. Enviar livre
    // por baixo dos panos entregaria outra coisa sem avisar.
    await expect(montar({}).enviarModelo()).rejects.toThrow(/oficial/);
  });
});
