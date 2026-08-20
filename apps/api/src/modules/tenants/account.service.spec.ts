import { BadRequestException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AccountService } from './account.service';
import * as evolution from '../whatsapp/canal/evolution/evolution.client';

jest.mock('../whatsapp/canal/evolution/evolution.client', () => ({
  desconectar: jest.fn().mockResolvedValue({ ok: true }),
  apagarInstancia: jest.fn().mockResolvedValue({ ok: true }),
}));

/**
 * Apagar a empresa inteira.
 *
 * É a única ação do sistema que não tem desfazer: leva conversas,
 * mensagens, clientes e acessos junto, e não sobra de onde restaurar. Os
 * testes daqui cobrem as duas coisas que separam "apagou porque quis" de
 * "apagou sem querer" — a senha e o nome digitado —, as duas que vivem
 * FORA do banco e ninguém lembraria de conferir (a sessão do WhatsApp e os
 * anexos), e a ORDEM entre elas, que foi o que quebrou na primeira
 * tentativa real.
 */
const SENHA = 'senha-do-dono';

async function montar(extra: { assinatura?: string | null } = {}) {
  const passwordHash = await bcrypt.hash(SENHA, 4);
  const ordem: string[] = [];

  const global = {
    client: {
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ passwordHash, email: 'dono@empresa.com' }),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Padaria do Zé',
          _count: { conversations: 3, customers: 2, messages: 40, users: 1 },
        }),
        delete: jest.fn().mockImplementation(() => {
          ordem.push('apagou o tenant');
          return {};
        }),
      },
      billingAccount: {
        findFirst: jest.fn().mockResolvedValue({
          stripeSubscriptionId: extra.assinatura ?? null,
          planLabel: 'Grátis',
        }),
      },
      evolutionSettings: {
        findFirst: jest.fn().mockResolvedValue({
          baseUrl: 'https://evo.exemplo.com',
          apiKeyEncrypted: 'cifrada',
          instance: 'inteliwa-1',
        }),
      },
      // Um lote por tabela e acabou: menos que o tamanho do lote é o sinal
      // de que a tabela esvaziou.
      $executeRawUnsafe: jest.fn().mockResolvedValue(3),
      // Solta as citações entre mensagens antes dos DELETEs.
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([
        { chave: 'tenant-1/2026/08/a.jpg' },
        { chave: 'tenant-1/2026/08/b.ogg' },
      ]),
    },
  };

  const storage = {
    apagarChaves: jest.fn().mockImplementation((chaves: string[]) => {
      ordem.push('apagou os anexos');
      return chaves.length;
    }),
    apagarDaEmpresa: jest.fn().mockResolvedValue(0),
  };

  const service = new AccountService(
    { tenantId: 'tenant-1' } as never,
    global as never,
    storage as never,
    { decrypt: jest.fn().mockReturnValue('chave-da-api') } as never,
  );

  return { service, global, storage, ordem };
}

const pedido = { password: SENHA, confirmacao: 'Padaria do Zé' };

beforeEach(() => {
  (evolution.desconectar as jest.Mock).mockClear().mockResolvedValue({ ok: true });
  (evolution.apagarInstancia as jest.Mock)
    .mockClear()
    .mockResolvedValue({ ok: true });
});

describe('apagar a conta', () => {
  it('apaga a empresa quando a senha e o nome batem', async () => {
    const { service, global } = await montar();

    await expect(service.excluir('user-1', pedido)).resolves.toEqual({
      apagada: true,
    });

    expect(global.client.tenant.delete).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
    });
  });

  it('aceita o nome com outra caixa e espaço sobrando', async () => {
    // O que se quer provar é que a pessoa LEU o nome, não que ela digita
    // bem.
    const { service, global } = await montar();

    await service.excluir('user-1', {
      password: SENHA,
      confirmacao: '  padaria do zé ',
    });

    expect(global.client.tenant.delete).toHaveBeenCalled();
  });

  it('recusa a senha errada', async () => {
    const { service, global } = await montar();

    await expect(
      service.excluir('user-1', { password: 'chute', confirmacao: 'Padaria do Zé' }),
    ).rejects.toThrow(BadRequestException);
    expect(global.client.tenant.delete).not.toHaveBeenCalled();
  });

  it('recusa quando o nome digitado é outro', async () => {
    // A confirmação existe justamente pra impedir o clique no automático.
    const { service, global } = await montar();

    await expect(
      service.excluir('user-1', { password: SENHA, confirmacao: 'apagar' }),
    ).rejects.toThrow(BadRequestException);
    expect(global.client.tenant.delete).not.toHaveBeenCalled();
  });

  it('não apaga com assinatura ativa', async () => {
    /*
     * O pior desfecho possível: a empresa some daqui e a cobrança segue
     * viva no provedor, todo mês, sem nenhuma tela pra cancelar. Ver o
     * aviso longo em AccountService, que é onde a integração de verdade
     * vai entrar.
     */
    const { service, global } = await montar({ assinatura: 'sub_123' });

    await expect(service.excluir('user-1', pedido)).rejects.toThrow(
      ConflictException,
    );
    expect(global.client.tenant.delete).not.toHaveBeenCalled();
  });
});

describe('o que o banco não alcança', () => {
  it('solta as citações antes de apagar as mensagens', async () => {
    /*
     * Uma mensagem cita outra da mesma tabela, com `ON DELETE SET NULL`:
     * apagar uma obriga o banco a atualizar quem a citava. Zerando a
     * coluna antes, o DELETE não dispara mais nenhuma dessas atualizações
     * — menos linhas travadas por transação, que é de onde vinha o
     * impasse.
     */
    const { service, global } = await montar();

    await service.excluir('user-1', pedido);

    const sql = String(global.client.$executeRaw.mock.calls[0][0]);
    expect(sql).toContain('replyToId');
  });

  it('refaz o lote que o banco matou por impasse', async () => {
    // Impasse não deixa nada inconsistente: a instrução simplesmente não
    // aconteceu. Refazer é o tratamento normal — e é o que separa "a
    // conta não foi apagada" de "um lote demorou um pouco mais".
    const { service, global } = await montar();
    global.client.$executeRawUnsafe
      .mockRejectedValueOnce(
        new Error("Raw query failed. Code: `40P01`. Message: `deadlock detected`"),
      )
      .mockResolvedValue(3);

    await expect(service.excluir('user-1', pedido)).resolves.toEqual({
      apagada: true,
    });
  });

  it('erro de banco que não é impasse sobe na hora', async () => {
    // Engolir tudo aqui esconderia uma exclusão pela metade.
    const { service, global } = await montar();
    global.client.$executeRawUnsafe.mockRejectedValue(new Error('banco fora do ar'));

    await expect(service.excluir('user-1', pedido)).rejects.toThrow(
      'banco fora do ar',
    );
  });

  it('apaga as linhas grandes em lotes, e não numa instrução só', async () => {
    /*
     * Um `DELETE` no tenant desce em cascata por vinte e cinco tabelas, e
     * a de mensagens tem uma linha por mensagem já trocada. Numa conta de
     * verdade isso estourou o tempo limite do banco (`57014`) e a conta
     * ficou inteira, sem ninguém entender por quê.
     */
    const { service, global } = await montar();

    await service.excluir('user-1', pedido);

    const tabelas = global.client.$executeRawUnsafe.mock.calls.map(
      ([sql]: [string]) => sql,
    );
    expect(tabelas.some((sql: string) => sql.includes('"messages"'))).toBe(true);
    // Mensagem antes de conversa: o contrário faria o banco cascatear a
    // tabela grande, que é a instrução gigante que estamos evitando.
    const primeira = tabelas.findIndex((sql: string) => sql.includes('"messages"'));
    const depois = tabelas.findIndex((sql: string) => sql.includes('"conversations"'));
    expect(primeira).toBeLessThan(depois);
    // O tenant só sai depois que as grandes saíram.
    expect(global.client.tenant.delete).toHaveBeenCalled();
  });

  it('apaga os anexos pela lista do banco, sem listar o bucket', async () => {
    // Listar exige `s3:ListBucket`, permissão que a chave de acesso do
    // armazenamento não tinha — e foi por isso que os arquivos ficaram
    // pra trás na primeira tentativa real.
    const { service, storage } = await montar();

    await service.excluir('user-1', pedido);

    expect(storage.apagarChaves).toHaveBeenCalledWith([
      'tenant-1/2026/08/a.jpg',
      'tenant-1/2026/08/b.ogg',
    ]);
  });

  it('desliga a sessão do WhatsApp DEPOIS de apagar', async () => {
    /*
     * A ordem é o conserto. Desligando antes, uma falha no banco deixava
     * a empresa com o WhatsApp desconectado e a conta viva — o pior
     * estado possível, porque o atendimento para e ninguém sabe que
     * parou.
     */
    const { service, global } = await montar();
    global.client.tenant.delete.mockImplementation(() => {
      throw new Error('tempo limite do banco');
    });

    await expect(service.excluir('user-1', pedido)).rejects.toThrow(
      'tempo limite do banco',
    );
    expect(evolution.desconectar).not.toHaveBeenCalled();
  });

  it('apaga mesmo com o servidor de mensagens fora do ar', async () => {
    // Sessão órfã é ruim; conta que a pessoa não consegue apagar porque um
    // serviço de fora caiu é pior.
    const { service, global } = await montar();
    (evolution.desconectar as jest.Mock).mockRejectedValue(new Error('sem resposta'));

    await expect(service.excluir('user-1', pedido)).resolves.toEqual({
      apagada: true,
    });
    expect(global.client.tenant.delete).toHaveBeenCalled();
  });

  it('recusa a segunda exclusão da mesma conta ao mesmo tempo', async () => {
    /*
     * Apagar uma conta grande demora, e a tela não mostra progresso: a
     * pessoa acha que travou, recarrega e aperta de novo. Duas exclusões
     * apagando as mesmas linhas é exatamente o par que o banco mata por
     * impasse.
     */
    const { service, global } = await montar();
    let liberar!: () => void;
    global.client.tenant.delete.mockImplementation(
      () => new Promise((pronto) => (liberar = () => pronto({}))),
    );

    const primeira = service.excluir('user-1', pedido);
    await expect(service.excluir('user-1', pedido)).rejects.toThrow(
      ConflictException,
    );

    liberar();
    await primeira;
  });

  it('a trava sai do caminho quando a exclusão falha', async () => {
    // Depois de um erro, tentar de novo é justamente o que se quer poder
    // fazer.
    const { service, global } = await montar();
    global.client.tenant.delete.mockImplementationOnce(() => {
      throw new Error('caiu no meio');
    });

    await expect(service.excluir('user-1', pedido)).rejects.toThrow('caiu no meio');
    await expect(service.excluir('user-1', pedido)).resolves.toEqual({
      apagada: true,
    });
  });

  it('apaga mesmo quando o armazenamento recusa', async () => {
    const { service, global, storage } = await montar();
    storage.apagarChaves.mockRejectedValue(new Error('AccessDenied'));

    await expect(service.excluir('user-1', pedido)).resolves.toEqual({
      apagada: true,
    });
    expect(global.client.tenant.delete).toHaveBeenCalled();
  });
});
