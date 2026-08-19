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
import * as evolution from '../whatsapp/canal/evolution/evolution.client';
import type { ExcluirContaDto } from './dto/excluir-conta.dto';

/**
 * Quantas linhas saem por vez.
 *
 * O banco derruba uma instrução que passa do tempo limite dele
 * (`statement_timeout`), e apagar a empresa de uma vez é a maior instrução
 * que este sistema já emitiu: um `DELETE` no tenant desce em cascata por
 * vinte e cinco tabelas, e a de mensagens sozinha tem uma linha por
 * mensagem já trocada. Foi assim que a primeira tentativa real morreu —
 * `57014: canceling statement due to statement timeout`, com a conta
 * inteira intacta e a pessoa sem entender por quê.
 *
 * Cinco mil é grande o bastante pra terminar rápido e pequeno o bastante
 * pra caber com folga em qualquer limite de tempo configurado.
 */
const LOTE = 5000;

/**
 * Teto de segurança do laço.
 *
 * Se um lote parar de reduzir a tabela (gatilho, permissão, defeito), o
 * laço rodaria pra sempre segurando a requisição. Cem mil voltas cobrem
 * meio bilhão de linhas — muito além do plausível — e ainda assim o laço
 * tem fim.
 */
const MAXIMO_DE_LOTES = 100_000;

/**
 * Quantas chaves de anexo cabem na memória de uma requisição.
 *
 * Elas são lidas ANTES de as mensagens saírem — depois não há mais de onde
 * tirá-las. Duzentas mil chaves são uns doze megabytes de texto, que passa;
 * um milhão começaria a doer num processo que também está atendendo o
 * painel de todo mundo. Acima do teto, o que sobrar fica pra varredura por
 * prefixo, e o log avisa.
 */
const TETO_DE_CHAVES = 200_000;

/**
 * As tabelas grandes, na ordem em que precisam sair.
 *
 * Mensagem antes de conversa, conversa antes de cliente: cada uma aponta
 * pra seguinte, e apagar a de cima primeiro faz o banco cascatear a de
 * baixo — o que traria de volta a instrução gigante que estamos evitando.
 * O resto das tabelas é pequeno e sai no `delete` do tenant, no fim.
 *
 * A lista é FIXA, escrita aqui: os nomes entram numa instrução montada
 * como texto (`$executeRawUnsafe`), e a única razão de isso ser seguro é
 * eles nunca virem de fora. O tenant continua indo como parâmetro.
 */
const TABELAS_GRANDES = [
  'messages',
  'conversation_tags',
  'tasks',
  'customer_notes',
  'conversations',
  'customers',
  'knowledge_chunks',
  'knowledge_documents',
  'audit_logs',
] as const;

/**
 * Apagar a empresa inteira — e o que "inteira" precisa mesmo alcançar.
 *
 * A parte fácil é o banco: todas as tabelas apontam pro tenant com
 * `ON DELETE CASCADE`, então uma linha a menos leva conversas, mensagens,
 * clientes, usuários e configurações junto. Fácil de escrever e, numa
 * conta de verdade, grande demais pra caber numa instrução só — daí os
 * lotes acima.
 *
 * A parte que só aparece depois é o que vive FORA do banco, e é por isso
 * que este serviço existe em vez de um `delete` solto no controlador:
 *
 * 1. A sessão do WhatsApp continua de pé no servidor de mensagens, ligada
 *    ao celular de alguém. Sem desconectar, fica uma sessão órfã
 *    consumindo memória lá e recebendo mensagem que ninguém mais lê.
 * 2. Os anexos ficam no bucket. Apagar as linhas e deixar os arquivos é o
 *    pior dos dois mundos: são documentos de clientes de uma empresa que
 *    pediu pra sumir, ninguém mais sabe que existem, e o espaço continua
 *    sendo pago.
 *
 * E a ORDEM entre as três coisas é decidida, não acidental: primeiro se
 * anota o que será preciso lá fora, depois o banco, e só então o mundo
 * externo. Ao contrário — como estava —, uma falha no banco deixava a
 * empresa com o WhatsApp já desconectado e a conta viva: o pior estado
 * possível, porque o atendimento para e ninguém sabe que parou.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly global: PrismaService,
    private readonly storage: StorageService,
    private readonly encryption: EncryptionService,
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

    // 1. O que vai ser preciso DEPOIS, anotado enquanto as linhas existem.
    const sessao = await this.sessaoDoWhatsapp(tenantId);
    const anexos = await this.chavesDosAnexos(tenantId);

    // 2. O banco, em lotes.
    const apagadas = await this.apagarLinhas(tenantId);
    await this.global.client.tenant.delete({ where: { id: tenantId } });

    // 3. E agora o mundo lá fora, com a conta já apagada. Nenhuma falha
    //    daqui pra baixo desfaz o que foi feito — só vira aviso no log.
    await this.desligarSessao(tenantId, sessao);
    const removidos = await this.apagarAnexos(tenantId, anexos);

    this.logger.warn(
      `Conta apagada: empresa ${tenantId} ("${tenant.name}") a pedido de ${usuario.email}; ` +
        `${apagadas} linhas e ${removidos} anexos removidos.`,
    );

    return { apagada: true as const };
  }

  /**
   * As tabelas grandes, aos poucos, até não sobrar nada.
   *
   * `$executeRawUnsafe` porque o nome da tabela não pode ir como
   * parâmetro em SQL — nenhum banco aceita isso. O nome vem de
   * `TABELAS_GRANDES`, que é uma lista fixa escrita neste arquivo; o
   * tenant, que é o único valor vindo de fora, continua parametrizado.
   *
   * O `IN (SELECT ... LIMIT)` é o jeito de limitar um DELETE no Postgres:
   * ele não aceita `LIMIT` direto.
   */
  private async apagarLinhas(tenantId: string): Promise<number> {
    let total = 0;

    for (const tabela of TABELAS_GRANDES) {
      for (let volta = 0; volta < MAXIMO_DE_LOTES; volta += 1) {
        const apagadas = await this.global.client.$executeRawUnsafe(
          `DELETE FROM "${tabela}" WHERE "id" IN (
             SELECT "id" FROM "${tabela}" WHERE "tenantId" = $1 LIMIT ${LOTE}
           )`,
          tenantId,
        );
        total += apagadas;
        if (apagadas < LOTE) break;
      }
    }

    return total;
  }

  /**
   * Onde os anexos desta empresa estão guardados.
   *
   * Lido do banco, e não listando o bucket: listar exige `s3:ListBucket`,
   * uma permissão que a chave de acesso do armazenamento costuma não ter
   * — e não tinha ("not authorized to perform: s3:ListBucket"), o que
   * deixou os arquivos pra trás na primeira tentativa real. A chave de
   * cada arquivo já está gravada junto da mensagem dele.
   */
  private async chavesDosAnexos(tenantId: string): Promise<string[]> {
    const linhas = await this.global.client.$queryRaw<{ chave: string }[]>`
      SELECT DISTINCT "metadata" ->> 'storageKey' AS chave
      FROM "messages"
      WHERE "tenantId" = ${tenantId}
        AND "metadata" ->> 'storageKey' IS NOT NULL
      LIMIT ${TETO_DE_CHAVES}
    `;
    const chaves = linhas.map((linha) => linha.chave).filter(Boolean);

    if (chaves.length === TETO_DE_CHAVES) {
      this.logger.warn(
        `Conta ${tenantId}: mais de ${TETO_DE_CHAVES} anexos. O que passar disso ` +
          'depende da varredura por prefixo, que precisa de s3:ListBucket.',
      );
    }

    return chaves;
  }

  private async apagarAnexos(tenantId: string, chaves: string[]): Promise<number> {
    let removidos = 0;

    try {
      removidos = await this.storage.apagarChaves(chaves);
    } catch (erro) {
      this.logger.error(
        `Conta ${tenantId}: ${chaves.length} anexos NÃO foram apagados do armazenamento (${
          erro instanceof Error ? erro.message : erro
        }). Eles ficaram órfãos no bucket e precisam ser removidos à mão.`,
      );
    }

    /*
     * A varredura por prefixo, como sobra.
     *
     * Pega o que ficou fora da lista do banco — um arquivo cuja mensagem
     * já tinha sido apagada pela política de retenção, por exemplo. É a
     * parte que precisa de `s3:ListBucket`, então falhar aqui é rotina e
     * não merece nem o tom de erro: o que importava já saiu acima.
     */
    try {
      removidos += await this.storage.apagarDaEmpresa(tenantId);
    } catch (erro) {
      this.logger.warn(
        `Conta ${tenantId}: a varredura de sobra no armazenamento não rodou (${
          erro instanceof Error ? erro.message : erro
        }). Os anexos conhecidos já foram apagados pela lista do banco.`,
      );
    }

    return removidos;
  }

  /** As credenciais da sessão, lidas antes de a linha sumir. */
  private async sessaoDoWhatsapp(tenantId: string) {
    const config = await this.global.client.evolutionSettings.findFirst({
      where: { tenantId },
      select: { baseUrl: true, apiKeyEncrypted: true, instance: true },
    });
    if (!config) return null;

    try {
      return {
        baseUrl: config.baseUrl,
        apiKey: this.encryption.decrypt(config.apiKeyEncrypted),
        instance: config.instance,
      };
    } catch {
      // Chave de criptografia trocada: sem como falar com o servidor de
      // mensagens. Vira aviso na hora de desligar, não impede de apagar.
      return null;
    }
  }

  private async desligarSessao(
    tenantId: string,
    sessao: evolution.Credenciais | null,
  ) {
    if (!sessao) return;

    try {
      await evolution.desconectar(sessao);
      const apagada = await evolution.apagarInstancia(sessao);
      // "instance does not exist" é o caso comum e não é problema: a
      // sessão já tinha sido trocada ou removida antes.
      if (!apagada.ok) {
        this.logger.log(
          `Conta ${tenantId}: sessão ${sessao.instance} não foi apagada no servidor de mensagens (${apagada.erro}).`,
        );
      }
    } catch (erro) {
      this.logger.warn(
        `Conta ${tenantId}: não deu pra desligar a sessão ${sessao.instance} (${
          erro instanceof Error ? erro.message : erro
        }). Ela pode ter ficado no servidor de mensagens.`,
      );
    }
  }
}
