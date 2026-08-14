import { InboxSettingsService } from './inbox-settings.service';

/**
 * A configuração de atendimento é a linha mais relida do sistema.
 *
 * Responder UMA mensagem passa por ela quatro vezes: pra saber se assina
 * com o nome de quem respondeu, se reabre a conversa encerrada, se manda
 * confirmação de leitura e se avisa ao resolver. Quatro idas ao banco pela
 * mesma linha, que não muda no meio de uma requisição.
 *
 * O cache vive dentro do serviço, que é de escopo de requisição — nasce e
 * morre com o pedido. É isso que o torna seguro num sistema onde cada
 * requisição pertence a uma empresa diferente, e é o que estes testes
 * guardam junto com a economia.
 */
function servicoCom(existente: Record<string, unknown> | null) {
  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      inboxSettings: {
        findFirst: jest.fn().mockResolvedValue(existente),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'cfg-nova', tenantId: 'tenant-teste' }),
        update: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) => ({
            id: 'cfg-1',
            ...args.data,
          })),
      },
    },
  };

  return { service: new InboxSettingsService(prisma as never), prisma };
}

const existente = { id: 'cfg-1', showAgentName: false, sendReadReceipts: true };

describe('leitura', () => {
  it('consulta o banco uma vez só, por mais que perguntem', async () => {
    const { service, prisma } = servicoCom(existente);

    await service.get();
    await service.get();
    await service.get();

    expect(prisma.db.inboxSettings.findFirst).toHaveBeenCalledTimes(1);
  });

  it('leituras simultâneas compartilham a mesma consulta', async () => {
    // O envio de mensagem dispara várias em paralelo. Guardando a promessa
    // (e não o resultado), elas esperam a mesma ida ao banco em vez de
    // abrirem quatro.
    const { service, prisma } = servicoCom(existente);

    const [a, b, c] = await Promise.all([
      service.get(),
      service.get(),
      service.get(),
    ]);

    expect(prisma.db.inboxSettings.findFirst).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('devolve sempre o mesmo conteúdo', async () => {
    const { service } = servicoCom(existente);

    await expect(service.get()).resolves.toMatchObject({ id: 'cfg-1' });
    await expect(service.get()).resolves.toMatchObject({ id: 'cfg-1' });
  });
});

describe('primeira leitura de uma empresa sem configuração', () => {
  it('cria com os padrões em vez de devolver vazio', async () => {
    // Nasce na leitura, e não no registro do tenant: assim empresas
    // criadas antes desta tela existir também ganham a configuração, sem
    // migração de dados.
    const { service, prisma } = servicoCom(null);

    await expect(service.get()).resolves.toMatchObject({ id: 'cfg-nova' });
    expect(prisma.db.inboxSettings.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant-teste' },
    });
  });

  it('não cria duas vezes quando duas leituras correm juntas', async () => {
    // Sem o cache da promessa, duas leituras simultâneas numa empresa nova
    // criariam duas linhas — e a segunda bateria na chave única.
    const { service, prisma } = servicoCom(null);

    await Promise.all([service.get(), service.get()]);

    expect(prisma.db.inboxSettings.create).toHaveBeenCalledTimes(1);
  });
});

describe('escrita', () => {
  it('quem salvou passa a ler o valor novo, não o de antes', async () => {
    // O cache não pode sobreviver à própria escrita: salvar a tela e o
    // resto do pedido continuar decidindo pelo valor velho seria um
    // defeito silencioso e difícil de acreditar.
    const { service } = servicoCom(existente);

    await service.get();
    await service.update({ showAgentName: true });

    await expect(service.get()).resolves.toMatchObject({
      showAgentName: true,
    });
  });

  it('não relê o banco pra descobrir o que acabou de gravar', async () => {
    const { service, prisma } = servicoCom(existente);

    await service.update({ sendReadReceipts: false });
    await service.get();

    expect(prisma.db.inboxSettings.findFirst).toHaveBeenCalledTimes(1);
  });
});
