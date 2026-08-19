import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { StorageService } from '../storage/storage.service';
import { EvolutionService } from '../whatsapp/canal/evolution/evolution.service';
import type { ExcluirContaDto } from './dto/excluir-conta.dto';

/**
 * Apagar a empresa inteira — e o que "inteira" precisa mesmo alcançar.
 *
 * A parte fácil é o banco: todas as tabelas apontam pro tenant com
 * `ON DELETE CASCADE`, então uma linha a menos leva conversas, mensagens,
 * clientes, usuários e configurações junto. É rápido e é irreversível.
 *
 * A parte que só aparece depois é o que vive FORA do banco, e é por isso
 * que este serviço existe em vez de um `delete` solto no controlador:
 *
 * 1. A sessão do WhatsApp continua de pé no servidor de mensagens, ligada
 *    ao celular de alguém. Sem desconectar antes, fica uma sessão órfã
 *    consumindo memória lá e recebendo mensagem que ninguém mais lê — e o
 *    aparelho do cliente segue mostrando um aparelho vinculado que ele não
 *    consegue mais desvincular por aqui.
 * 2. Os anexos ficam no bucket. Apagar as linhas e deixar os arquivos é o
 *    pior dos dois mundos: são documentos de clientes de uma empresa que
 *    pediu pra sumir, ninguém mais sabe que existem, e o espaço continua
 *    sendo pago.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly global: PrismaService,
    private readonly storage: StorageService,
    private readonly evolution: EvolutionService,
  ) {}

  /**
   * O que a tela precisa saber antes de oferecer o botão.
   *
   * O nome vem daqui, e não do que o navegador tem em cache, porque é ele
   * que a pessoa vai ter de digitar pra confirmar — um nome desatualizado
   * na tela viraria uma confirmação que nunca bate.
   */
  async resumo() {
    const tenant = await this.global.client.tenant.findUnique({
      where: { id: this.prisma.tenantId },
      select: {
        name: true,
        _count: {
          select: { conversations: true, customers: true, messages: true, users: true },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Empresa não encontrada.');

    const billing = await this.global.client.billingAccount.findFirst({
      where: { tenantId: this.prisma.tenantId },
      select: { stripeSubscriptionId: true, planLabel: true },
    });

    return {
      nome: tenant.name,
      conversas: tenant._count.conversations,
      clientes: tenant._count.customers,
      mensagens: tenant._count.messages,
      pessoas: tenant._count.users,
      assinaturaAtiva: Boolean(billing?.stripeSubscriptionId),
      plano: billing?.planLabel ?? 'Grátis',
    };
  }

  async excluir(userId: string, dto: ExcluirContaDto) {
    const tenantId = this.prisma.tenantId;

    const usuario = await this.global.client.user.findFirst({
      where: { id: userId, tenantId },
      select: { passwordHash: true, email: true },
    });
    if (!usuario) throw new NotFoundException('Usuário não encontrado.');

    const senhaConfere = await bcrypt.compare(dto.password, usuario.passwordHash);
    if (!senhaConfere) {
      throw new BadRequestException('Senha incorreta.');
    }

    const tenant = await this.global.client.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    if (!tenant) throw new NotFoundException('Empresa não encontrada.');

    // Espaço e caixa das letras não contam: o que se quer provar é que a
    // pessoa leu o nome, não que ela digita bem.
    const digitado = dto.confirmacao.trim().toLocaleLowerCase('pt-BR');
    const esperado = tenant.name.trim().toLocaleLowerCase('pt-BR');
    if (digitado !== esperado) {
      throw new BadRequestException(
        `Pra confirmar, digite exatamente o nome da empresa: ${tenant.name}`,
      );
    }

    /*
     * ⚠️ COBRANÇA: ISTO PRECISA MUDAR QUANDO O PLANO FOR PAGO.
     *
     * Hoje a barreira é esta: existe assinatura registrada? Então a conta
     * não é apagada, e a pessoa é mandada cancelar primeiro. É o
     * comportamento certo ENQUANTO não houver integração de verdade — o
     * pior desfecho possível é apagar a empresa aqui e a assinatura
     * continuar viva no Stripe, cobrando todo mês de um cliente que não
     * tem mais conta, sem tela nenhuma pra ele cancelar e sem ninguém pra
     * reclamar até a fatura chegar.
     *
     * Quando a cobrança entrar de fato (Stripe ou outro), o caminho certo
     * é o inverso e tem uma ordem obrigatória:
     *
     *   1. Cancelar a assinatura no provedor (`stripeSubscriptionId`),
     *      esperando a confirmação DELE — não a nossa suposição.
     *   2. Só então apagar. Se o cancelamento falhar, PARE aqui: é melhor
     *      uma conta viva que ninguém quer do que uma cobrança órfã.
     *   3. Decidir explicitamente o que fazer com o período já pago —
     *      apagar no ato (perde o que sobrou) ou agendar pro fim do ciclo.
     *      A segunda é a que não gera contestação de cartão.
     *   4. Guardar o mínimo fiscal FORA do tenant antes do cascade: nota
     *      emitida e histórico de pagamento não podem sumir junto, e hoje
     *      eles sumiriam.
     *
     * O identificador da assinatura vive em `BillingAccount`
     * (`stripeCustomerId`, `stripeSubscriptionId`) — e some no cascade,
     * junto com o resto.
     */
    const billing = await this.global.client.billingAccount.findFirst({
      where: { tenantId },
      select: { stripeSubscriptionId: true },
    });
    if (billing?.stripeSubscriptionId) {
      throw new ConflictException(
        'Esta empresa tem uma assinatura ativa. Cancele a assinatura antes de apagar a conta — ' +
          'apagar agora deixaria a cobrança correndo sem nenhuma conta pra cancelá-la.',
      );
    }

    // Desligar o WhatsApp ANTES, e sem deixar a falha impedir o resto: uma
    // sessão órfã é ruim, mas uma conta que a pessoa não consegue apagar
    // porque o servidor de mensagens está fora do ar é pior.
    try {
      await this.evolution.desconectar();
    } catch (erro) {
      this.logger.warn(
        `Conta ${tenantId}: não deu pra desconectar o WhatsApp antes de apagar (${
          erro instanceof Error ? erro.message : erro
        }). A sessão pode ter ficado no servidor de mensagens.`,
      );
    }

    let anexos = 0;
    try {
      anexos = await this.storage.apagarDaEmpresa(tenantId);
    } catch (erro) {
      this.logger.error(
        `Conta ${tenantId}: os anexos NÃO foram apagados do armazenamento (${
          erro instanceof Error ? erro.message : erro
        }). Eles ficaram órfãos no bucket e precisam ser removidos à mão.`,
      );
    }

    // O cascade do banco faz o resto: usuários, clientes, conversas,
    // mensagens, etiquetas, filas, configurações e o registro de auditoria.
    await this.global.client.tenant.delete({ where: { id: tenantId } });

    this.logger.warn(
      `Conta apagada: empresa ${tenantId} ("${tenant.name}") a pedido de ${usuario.email}; ` +
        `${anexos} anexos removidos do armazenamento.`,
    );

    return { apagada: true as const };
  }
}
