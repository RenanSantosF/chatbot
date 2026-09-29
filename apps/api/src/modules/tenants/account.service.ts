import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { StorageService } from '../storage/storage.service';
import { ApagadorDeEmpresa } from './apagador-de-empresa';
import type { ExcluirContaDto } from './dto/excluir-conta.dto';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  /** Quem apaga de fato (ver ApagadorDeEmpresa); aqui ficam as conferências. */
  private readonly apagador: ApagadorDeEmpresa;

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly global: PrismaService,
    storage: StorageService,
    encryption: EncryptionService,
  ) {
    this.apagador = new ApagadorDeEmpresa(global, storage, encryption);
  }

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
          select: {
            conversations: true,
            customers: true,
            messages: true,
            users: true,
          },
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

    const senhaConfere = await bcrypt.compare(
      dto.password,
      usuario.passwordHash,
    );
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
     * ⚠️ COBRANÇA: A BARREIRA JÁ VALE DE VERDADE — O CANCELAMENTO
     * AUTOMÁTICO, AINDA NÃO.
     *
     * Desde que o Stripe entrou (ver BillingService), `stripeSubscriptionId`
     * é gravado de verdade por webhook — não fica mais sempre nulo. Então
     * esta barreira, que antes era teórica, agora bloqueia contas com
     * assinatura de fato ativa: existe assinatura registrada? Então a
     * conta não é apagada, e a pessoa é mandada cancelar primeiro (pelo
     * Portal do Stripe — ver BillingService.criarPortal). É o comportamento
     * certo ENQUANTO apagar não cancela sozinho — o pior desfecho possível
     * é apagar a empresa aqui e a assinatura continuar viva no Stripe,
     * cobrando todo mês de um cliente que não tem mais conta, sem tela
     * nenhuma pra ele cancelar e sem ninguém pra reclamar até a fatura
     * chegar.
     *
     * Fazer o cancelamento acontecer SOZINHO aqui dentro (em vez de só
     * bloquear e mandar cancelar à parte) é o próximo passo, e tem uma
     * ordem obrigatória:
     *
     *   1. Cancelar a assinatura no Stripe (`stripeSubscriptionId`),
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

    return this.apagador.apagar(tenantId, {
      nome: tenant.name,
      porQuem: usuario.email,
    });
  }
}
