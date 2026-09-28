import {
  FOTO_VALIDA_AO_ABRIR_MS,
  FotoDePerfilService,
  INTERVALO_MINIMO_MS,
} from './foto-de-perfil.service';

/**
 * A foto buscada a pedido da tela — ao abrir a conversa e ao clicar nela.
 *
 * O defeito que isto resolve: a foto só era conferida quando o cliente
 * escrevia, então quem já estava na lista antes disso nunca ganhava foto.
 */
function montar(
  cliente: { avatarUrl: string | null; avatarVerificadoEm: Date | null } | null,
  foto: string | null | undefined = 'https://pps.whatsapp.net/nova.jpg',
) {
  const prisma = {
    db: {
      customer: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            cliente ? { id: 'c1', phone: '5511999999999', ...cliente } : null,
          ),
        update: jest.fn().mockResolvedValue({}),
      },
    },
  };
  const evolution = { fotoDePerfil: jest.fn().mockResolvedValue(foto) };
  const service = new FotoDePerfilService(prisma as never, evolution as never);
  return { service, prisma, evolution };
}

const atras = (ms: number) => new Date(Date.now() - ms);

describe('FotoDePerfilService', () => {
  it('busca a foto de quem nunca foi conferido', async () => {
    const { service, prisma, evolution } = montar({
      avatarUrl: null,
      avatarVerificadoEm: null,
    });

    await expect(service.atualizar('c1')).resolves.toEqual({
      avatarUrl: 'https://pps.whatsapp.net/nova.jpg',
    });
    expect(evolution.fotoDePerfil).toHaveBeenCalledWith('5511999999999');
    expect(prisma.db.customer.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        avatarUrl: 'https://pps.whatsapp.net/nova.jpg',
        avatarVerificadoEm: expect.any(Date) as Date,
      },
    });
  });

  it('ao abrir, não pergunta de novo se a foto é recente', async () => {
    const { service, evolution } = montar({
      avatarUrl: 'https://pps.whatsapp.net/velha.jpg',
      avatarVerificadoEm: atras(FOTO_VALIDA_AO_ABRIR_MS / 2),
    });

    await expect(service.atualizar('c1')).resolves.toEqual({
      avatarUrl: 'https://pps.whatsapp.net/velha.jpg',
    });
    expect(evolution.fotoDePerfil).not.toHaveBeenCalled();
  });

  it('ao clicar, busca mesmo com a foto recente', async () => {
    const { service, evolution } = montar({
      avatarUrl: 'https://pps.whatsapp.net/velha.jpg',
      avatarVerificadoEm: atras(INTERVALO_MINIMO_MS * 2),
    });

    await service.atualizar('c1', { forcar: true });
    expect(evolution.fotoDePerfil).toHaveBeenCalled();
  });

  it('dois cliques seguidos não viram duas perguntas ao WhatsApp', async () => {
    const { service, evolution } = montar({
      avatarUrl: 'https://pps.whatsapp.net/velha.jpg',
      avatarVerificadoEm: atras(1000),
    });

    await service.atualizar('c1', { forcar: true });
    expect(evolution.fotoDePerfil).not.toHaveBeenCalled();
  });

  it('grava "sem foto" quando a pessoa esconde a foto', async () => {
    const { service, prisma } = montar(
      {
        avatarUrl: 'https://pps.whatsapp.net/velha.jpg',
        avatarVerificadoEm: null,
      },
      null,
    );

    await expect(service.atualizar('c1')).resolves.toEqual({ avatarUrl: null });
    expect(prisma.db.customer.update).toHaveBeenCalled();
  });

  it('pergunta que falhou mantém a foto que havia e não grava nada', async () => {
    const { service, prisma, evolution } = montar({
      avatarUrl: 'https://pps.whatsapp.net/velha.jpg',
      avatarVerificadoEm: null,
    });
    // Aqui, e não pelo argumento de `montar`: `undefined` ali cairia no
    // valor padrão.
    evolution.fotoDePerfil.mockResolvedValue(undefined);

    await expect(service.atualizar('c1')).resolves.toEqual({
      avatarUrl: 'https://pps.whatsapp.net/velha.jpg',
    });
    expect(prisma.db.customer.update).not.toHaveBeenCalled();
  });

  it('cliente de outra empresa (ou inexistente) é 404', async () => {
    const { service } = montar(null);
    await expect(service.atualizar('c1')).rejects.toThrow(
      'Cliente não encontrado.',
    );
  });
});
