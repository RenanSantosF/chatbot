import { CustomersService, temNomeDeVerdade } from './customers.service';

/**
 * Como o cliente ganha nome.
 *
 * O painel inteiro chama a pessoa por este campo, e a busca procura por
 * ele. Um nome errado aqui não é cosmético: é o atendente que não acha o
 * cliente e fala com ele por um nome que não é o dele.
 */
function montar(existente: Record<string, unknown> | null) {
  const update = jest.fn().mockImplementation((args: { data: unknown }) => ({
    ...existente,
    ...(args.data as object),
  }));
  const create = jest
    .fn()
    .mockImplementation((args: { data: unknown }) => args.data);

  const prisma = {
    tenantId: 'tenant-teste',
    db: { customer: { findFirst: jest.fn().mockResolvedValue(existente), create, update } },
  };

  return { service: new CustomersService(prisma as never), create, update };
}

describe('"Você" não é nome de ninguém', () => {
  it('reconhece o telefone como ausência de nome', () => {
    expect(temNomeDeVerdade('5527999998888', '5527999998888')).toBe(false);
  });

  it('reconhece "Você" — com e sem acento — como ausência de nome', () => {
    // Vem do histórico do aparelho, nas mensagens que a EMPRESA mandou.
    expect(temNomeDeVerdade('Você', '5527999998888')).toBe(false);
    expect(temNomeDeVerdade('voce', '5527999998888')).toBe(false);
    expect(temNomeDeVerdade('  YOU  ', '5527999998888')).toBe(false);
  });

  it('aceita nome de gente', () => {
    expect(temNomeDeVerdade('Richard', '5527999998888')).toBe(true);
    expect(temNomeDeVerdade('Ana Você da Silva', '5527999998888')).toBe(true);
  });
});

describe('nome vindo da agenda', () => {
  it('conserta quem foi batizado de "Você"', async () => {
    // Sem isto, o registro torto ficava torto pra sempre: "Você" passava
    // pela conferência de "já tem nome" e nada mais entrava por cima.
    const { service, update } = montar({
      id: 'cliente-1',
      phone: '5527999998888',
      name: 'Você',
    });

    await service.upsertFromAddressBook({
      phone: '5527999998888',
      name: 'Richard',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Richard' } }),
    );
  });

  it('sobrescreve o apelido quando vem da agenda', async () => {
    const { service, update } = montar({
      id: 'cliente-1',
      phone: '5527999998888',
      name: 'Rick 🔥',
    });

    await service.upsertFromAddressBook({
      phone: '5527999998888',
      name: 'Richard Oliveira',
      daAgenda: true,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Richard Oliveira' } }),
    );
  });

  it('NÃO sobrescreve um nome bom com um apelido qualquer', async () => {
    // O apelido público muda ao sabor de quem o escolheu. Deixar que ele
    // ganhe da agenda faria o cliente trocar de nome sozinho no painel.
    const { service, update } = montar({
      id: 'cliente-1',
      phone: '5527999998888',
      name: 'Richard Oliveira',
    });

    await service.upsertFromAddressBook({
      phone: '5527999998888',
      name: 'Rick 🔥',
    });

    expect(update).not.toHaveBeenCalled();
  });

  it('cliente novo nasce com o nome, e com o telefone quando não há nome', async () => {
    const { service, create } = montar(null);

    await service.upsertFromAddressBook({ phone: '5527999998888' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: '5527999998888' }),
      }),
    );
  });
});

/**
 * A lista do aparelho não é a agenda.
 *
 * O que a Evolution entrega é tudo que o WhatsApp conhece: quem escreveu
 * uma vez, participante de grupo, quem caiu numa transmissão. Todos eles
 * têm apelido público, e nenhum deles foi salvo pela empresa. Criar
 * cadastro a partir daí enchia a lista de "nova conversa" de gente que o
 * dono do número jurava nunca ter salvo — e ele estava certo.
 */
describe('quem NÃO está salvo na agenda', () => {
  it('não vira cliente', async () => {
    const { service, create } = montar(null);

    const salvo = await service.upsertFromAddressBook({
      phone: '5527999998888',
      name: 'Rick',
      criarSeNovo: false,
    });

    expect(create).not.toHaveBeenCalled();
    expect(salvo).toBeNull();
  });

  it('mas ainda dá nome a quem já é cliente e está gravado como telefone', async () => {
    // Este é o ganho que se perderia proibindo tudo: quem conversou com a
    // empresa e nunca se identificou aparece como um número na tela.
    const { service, update } = montar({
      id: 'cliente-1',
      phone: '5527999998888',
      name: '5527999998888',
    });

    await service.upsertFromAddressBook({
      phone: '5527999998888',
      name: 'Rick',
      criarSeNovo: false,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Rick' } }),
    );
  });
});
