import { BadRequestException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AccountService } from './account.service';

/**
 * Apagar a empresa inteira.
 *
 * É a única ação do sistema que não tem desfazer: o cascade leva
 * conversas, mensagens, clientes e acessos junto, e não sobra de onde
 * restaurar. Os testes daqui cobrem as duas coisas que separam "apagou
 * porque quis" de "apagou sem querer" — a senha e o nome digitado — e as
 * duas que vivem FORA do banco e ninguém lembraria de conferir: a sessão
 * do WhatsApp e os anexos no armazenamento.
 */
const SENHA = 'senha-do-dono';

async function montar(extra: { assinatura?: string | null } = {}) {
  const passwordHash = await bcrypt.hash(SENHA, 4);

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
        delete: jest.fn().mockResolvedValue({}),
      },
      billingAccount: {
        findFirst: jest.fn().mockResolvedValue({
          stripeSubscriptionId: extra.assinatura ?? null,
          planLabel: 'Grátis',
        }),
      },
    },
  };

  const storage = { apagarDaEmpresa: jest.fn().mockResolvedValue(7) };
  const evolution = { desconectar: jest.fn().mockResolvedValue({}) };

  const service = new AccountService(
    { tenantId: 'tenant-1' } as never,
    global as never,
    storage as never,
    evolution as never,
  );

  return { service, global, storage, evolution };
}

describe('apagar a conta', () => {
  it('apaga a empresa quando a senha e o nome batem', async () => {
    const { service, global } = await montar();

    await expect(
      service.excluir('user-1', { password: SENHA, confirmacao: 'Padaria do Zé' }),
    ).resolves.toEqual({ apagada: true });

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
      service.excluir('user-1', {
        password: 'chute',
        confirmacao: 'Padaria do Zé',
      }),
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

    await expect(
      service.excluir('user-1', { password: SENHA, confirmacao: 'Padaria do Zé' }),
    ).rejects.toThrow(ConflictException);
    expect(global.client.tenant.delete).not.toHaveBeenCalled();
  });

  it('desliga o WhatsApp e limpa os anexos antes de apagar', async () => {
    // As duas coisas que o cascade do banco não alcança: a sessão fica
    // órfã no servidor de mensagens, e os arquivos ficam no bucket sem
    // ninguém saber que existem.
    const { service, storage, evolution } = await montar();

    await service.excluir('user-1', {
      password: SENHA,
      confirmacao: 'Padaria do Zé',
    });

    expect(evolution.desconectar).toHaveBeenCalled();
    expect(storage.apagarDaEmpresa).toHaveBeenCalledWith('tenant-1');
  });

  it('apaga mesmo com o servidor de mensagens fora do ar', async () => {
    // Sessão órfã é ruim; conta que a pessoa não consegue apagar porque um
    // serviço de fora caiu é pior.
    const { service, global, evolution } = await montar();
    evolution.desconectar.mockRejectedValue(new Error('sem resposta'));

    await service.excluir('user-1', {
      password: SENHA,
      confirmacao: 'Padaria do Zé',
    });

    expect(global.client.tenant.delete).toHaveBeenCalled();
  });
});
