import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { ParsedContact } from './contact-import';

interface FindOrCreateInput {
  phone: string;
  name: string;
  /**
   * É um grupo do WhatsApp, e não uma pessoa.
   *
   * Marcado na CRIAÇÃO e nunca depois: o que nasce grupo continua grupo, e
   * reavaliar a cada mensagem só criaria a chance de um grupo virar cliente
   * por causa de um evento com formato estranho.
   */
  grupo?: boolean;
}

/** O cliente como o banco devolve. */
type Cliente = Awaited<
  ReturnType<TenantPrismaService['db']['customer']['findFirstOrThrow']>
>;

interface ContatoDeAgenda {
  phone: string;
  name?: string;
  /**
   * O nome veio da AGENDA do aparelho, e não de um apelido que a pessoa
   * escolheu pra si.
   *
   * Quando vem de lá, ele ganha de qualquer coisa que já esteja gravada: é
   * o nome que a empresa usa pra falar dessa pessoa no dia a dia, e é o
   * único que conserta um registro que nasceu torto.
   */
  daAgenda?: boolean;
  /**
   * Pode CRIAR o cliente, ou só melhorar o nome de quem já existe?
   *
   * Padrão `true`, que é o caso de quem chegou por mensagem: aí o cadastro
   * nasce junto do atendimento e é isso que se quer.
   *
   * A sincronização da agenda passa `false` pra quem não está salvo no
   * aparelho. A lista que o WhatsApp entrega é tudo que ele conhece — quem
   * escreveu uma vez, participante de grupo, quem caiu numa transmissão — e
   * criar a partir dela enchia a base de gente que a empresa nunca
   * cadastrou. O nome ainda serve pra corrigir quem já é cliente e está
   * gravado como um telefone sem nome.
   */
  criarSeNovo?: boolean;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Nomes que não nomeiam ninguém.
 *
 * "Você" é o caso real: o histórico do aparelho traz, em cada mensagem, o
 * nome de exibição de quem a escreveu — e nas que a EMPRESA mandou esse
 * nome é o dela mesma, que o WhatsApp costuma entregar como "Você". Quando
 * a importação pegava esse valor, o cliente passava a se chamar "Você" no
 * painel inteiro.
 *
 * Tratá-los como vazio, em vez de sair apagando, é o que faz o registro se
 * consertar sozinho: no próximo contato — ou na próxima sincronização da
 * agenda — o nome de verdade entra por cima sem ninguém precisar mexer.
 */
const NOMES_QUE_NAO_SAO_NOME = new Set([
  'voce',
  'you',
  'eu',
  'me',
  'null',
  'undefined',
]);

/** O que está gravado serve pra chamar a pessoa pelo nome? */
export function temNomeDeVerdade(
  nome: string | null | undefined,
  telefone: string,
): boolean {
  const limpo = nome?.trim();
  if (!limpo) return false;
  // O telefone é o padrão de quem chegou sem se identificar.
  if (limpo === telefone) return false;

  const simples = limpo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return !NOMES_QUE_NAO_SAO_NOME.has(simples);
}

/**
 * Um contato, do jeito que a Evolution entrega.
 *
 * Os quatro nomes querem dizer coisas diferentes no BAILEYS, que é a
 * biblioteca por baixo: `name` é o que está salvo na agenda do aparelho,
 * `verifiedName` é o nome comercial verificado, e `notify`/`pushName` são
 * o apelido que a própria pessoa escolheu.
 *
 * A Evolution NÃO repassa essa diferença. O que sai dela é
 *
 *     { remoteJid, pushName, profilePicUrl, instanceId }
 *
 * com `pushName = contact.name || contact.verifiedName || <o número>` —
 * os três campos originais viram um só, e o campo que sobra tem o nome do
 * que menos vale. Os outros continuam declarados porque uma versão
 * diferente (ou um Baileys direto, um dia) ainda os manda.
 */
export interface ContatoDoAparelho {
  id?: string;
  remoteJid?: string;
  name?: string;
  notify?: string;
  pushName?: string;
  verifiedName?: string;
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private readonly prisma: TenantPrismaService) {}

  /**
   * A lista de clientes, com busca e teto.
   *
   * O teto não é detalhe: a agenda importada do aparelho traz TODO mundo
   * que a empresa já teve no celular — milhares de linhas. Devolver a
   * tabela inteira pra o navegador filtrar no braço fazia a tela demorar
   * segundos pra abrir e a busca só encontrar quem tivesse cabido na
   * resposta.
   *
   * Por isso a procura é aqui, no banco: quem digita "richard" quer achar
   * o Richard mesmo que ele seja o cliente número 4.000.
   */
  async list(filtros: { search?: string; limit?: number } = {}) {
    const busca = filtros.search?.trim();
    const limite = Math.min(Math.max(filtros.limit ?? 100, 1), 200);

    return this.prisma.db.customer.findMany({
      where: {
        // Grupo não é cliente. Ele aparece na aba própria do Inbox, e
        // listá-lo aqui misturaria "Fornecedores" no meio das pessoas —
        // inclusive na busca de quem vai puxar conversa com alguém.
        isGroup: false,
        ...(busca
          ? {
              OR: [
                { name: { contains: busca, mode: 'insensitive' as const } },
                // Sem `mode` no telefone: são só dígitos, e a comparação
                // insensível a maiúsculas custaria sem mudar resultado.
                { phone: { contains: busca } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limite,
    });
  }

  async getById(id: string) {
    return this.prisma.db.customer.findFirst({ where: { id } });
  }

  /**
   * Ponto de entrada de qualquer canal (simulador ou webhook do WhatsApp).
   * Telefone identifica o cliente dentro do
   * tenant — cria o cadastro na primeira mensagem, reaproveita depois.
   */
  /**
   * Importa uma lista de contatos. Quem já existe é atualizado só onde
   * havia buraco (nome vazio, e-mail ausente): a planilha do escritório
   * costuma ser mais pobre que o que o atendimento já descobriu, e
   * sobrescrever com ela seria perder informação boa.
   */
  async importContacts(contacts: ParsedContact[]) {
    let criados = 0;
    let atualizados = 0;

    for (const contact of contacts) {
      const existing = await this.prisma.db.customer.findFirst({
        where: { phone: contact.phone },
      });

      if (!existing) {
        await this.prisma.db.customer.create({
          data: {
            tenantId: this.prisma.tenantId,
            phone: contact.phone,
            name: contact.name,
            email: contact.email ?? null,
          },
        });
        criados++;
        continue;
      }

      const patch: { name?: string; email?: string } = {};
      const semNome = !existing.name || existing.name === existing.phone;
      if (semNome && contact.name !== contact.phone) patch.name = contact.name;
      if (!existing.email && contact.email) patch.email = contact.email;

      if (Object.keys(patch).length > 0) {
        await this.prisma.db.customer.update({
          where: { id: existing.id },
          data: patch,
        });
        atualizados++;
      }
    }

    return { criados, atualizados };
  }

  /**
   * Um contato vindo da agenda do celular (coexistência,
   * `smb_app_state_sync`).
   *
   * O nome do celular só preenche quem ainda não tem nome de verdade: se o
   * cliente já apareceu numa conversa, o nome do perfil do WhatsApp dele
   * vale mais que a etiqueta que a empresa deu na agenda. E como o telefone
   * costuma ser o próprio "nome" de quem chegou por mensagem, ele conta
   * como vazio pra esse fim.
   *
   * `remove` na agenda não apaga o cliente daqui: ele pode ter histórico de
   * atendimento, e sumir com a conversa por causa de uma faxina na agenda do
   * celular seria perda de dado.
   */
  // Duas assinaturas porque são dois contratos: quem deixa `criarSeNovo`
  // de fora SEMPRE recebe um cliente, e obrigar esses chamadores a testar
  // um `null` que não pode acontecer seria espalhar ramo morto por eles.
  async upsertFromAddressBook(
    input: ContatoDeAgenda & { criarSeNovo?: true },
  ): Promise<Cliente>;
  async upsertFromAddressBook(input: ContatoDeAgenda): Promise<Cliente | null>;
  async upsertFromAddressBook(input: ContatoDeAgenda): Promise<Cliente | null> {
    const nome = input.name?.trim();

    const existing = await this.prisma.db.customer.findFirst({
      where: { phone: input.phone },
    });

    if (!existing) {
      if (input.criarSeNovo === false) return null;
      return this.prisma.db.customer.create({
        data: {
          tenantId: this.prisma.tenantId,
          phone: input.phone,
          name: nome || input.phone,
        },
      });
    }

    if (nome && (input.daAgenda || !temNomeDeVerdade(existing.name, existing.phone))) {
      return this.prisma.db.customer.update({
        where: { id: existing.id },
        data: { name: nome },
      });
    }

    return existing;
  }

  /**
   * A agenda do aparelho virando o nome que aparece no painel.
   *
   * Sem isto, o nome de um cliente era o apelido que ele mesmo escolheu no
   * WhatsApp — quando escolheu. Quem não pôs nada virava um telefone na
   * tela, e não havia como achar ninguém pesquisando por nome.
   *
   * Vive aqui, e não no webhook, porque tem DOIS chamadores: o evento de
   * agenda que o aparelho manda ao parear, e a leitura sob demanda ao
   * conectar (ver `EvolutionService.conectar`) — que é o que conserta quem
   * já estava pareado quando o critério abaixo ainda deixava tudo de fora.
   *
   * Nada aqui lança: uma agenda que não veio é um painel com menos nomes,
   * não um webhook quebrado.
   */
  async importarAgenda(
    contatos: ContatoDoAparelho[],
  ): Promise<{ recebidos: number; salvos: number }> {
    let salvos = 0;

    for (const contato of contatos) {
      const telefone = telefoneDoContato(contato.id ?? contato.remoteJid ?? '');
      // Grupo e transmissão não são pessoa.
      if (!telefone) continue;

      /*
       * Qual nome vale, e por que o critério teve de mudar.
       *
       * A regra anterior era exigir `name` — o campo que, no Baileys, só
       * existe pra quem está salvo na agenda do aparelho. Ela nasceu de um
       * defeito real: aceitar o apelido público como prova de cadastro
       * enchia a lista de "nova conversa" de gente que a empresa nunca
       * salvou, porque TODO usuário do WhatsApp tem apelido.
       *
       * Só que a Evolution não entrega `name`. Ela entrega
       * `pushName = contact.name || contact.verifiedName || <o número>`, e
       * nada mais — a agenda e o apelido chegam pelo mesmo campo, com o
       * nome do apelido. Exigir `name` numa mensagem que nunca o traz não
       * era rigor: era não importar contato NENHUM, que foi o relato de
       * quem conectou uma conta nova e viu a agenda vazia.
       *
       * O que sobrou de sinal é o fallback dela: sem nome nenhum, o
       * `pushName` vem sendo o próprio número. Então "tem nome que não é o
       * número" é o mais perto de "alguém batizou esta pessoa" que dá pra
       * saber daqui — e é o critério agora.
       *
       * O que NÃO mudou é o outro caminho, que é onde o defeito original
       * de fato acontecia: o `pushName` que vem dentro de uma MENSAGEM
       * continua não criando contato nenhum (ver `receiveInbound`, em
       * ConversationsService). Ali o campo é mesmo o apelido escolhido
       * pela pessoa, sem ambiguidade.
       */
      const nome = (
        contato.name ??
        contato.verifiedName ??
        contato.notify ??
        contato.pushName ??
        ''
      ).trim();

      // Sem nome, ou com o número no lugar do nome, não há o que salvar:
      // gravar "5527999998888" como nome do 5527999998888 é ruído.
      if (!nome || nome.replace(/\D/g, '') === telefone) continue;

      const daAgenda = Boolean(
        contato.name?.trim() || contato.verifiedName?.trim(),
      );

      try {
        const salvo = await this.upsertFromAddressBook({
          phone: telefone,
          name: nome,
          // Nome de agenda ganha do que estiver gravado — é o que conserta
          // quem foi batizado de "Você" pela importação do histórico.
          daAgenda,
          criarSeNovo: true,
        });
        if (salvo) salvos += 1;
      } catch (erro) {
        this.logger.warn(
          `Não deu pra salvar o contato ${telefone}: ${erro instanceof Error ? erro.message : erro}`,
        );
      }
    }

    return { recebidos: contatos.length, salvos };
  }

  async findOrCreateByPhone({ phone, name, grupo }: FindOrCreateInput) {
    const existing = await this.prisma.db.customer.findFirst({ where: { phone } });
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.db.customer.create({
        data: { tenantId: this.prisma.tenantId, phone, name, isGroup: Boolean(grupo) },
      });
    } catch (error) {
      // Corrida entre duas mensagens quase simultâneas do mesmo número novo.
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const existingAfterRace = await this.prisma.db.customer.findFirst({ where: { phone } });
        if (existingAfterRace) {
          return existingAfterRace;
        }
      }
      throw error;
    }
  }
}

/**
 * O telefone dentro do identificador do WhatsApp.
 *
 * Grupo (`@g.us`) e transmissão não são pessoa, e devolvem `null` — tratar
 * um deles como cliente criaria um "contato" com o id do grupo.
 */
function telefoneDoContato(jid: string): string | null {
  const SUFIXO = '@s.whatsapp.net';
  if (!jid.endsWith(SUFIXO)) return null;
  const numero = jid.slice(0, -SUFIXO.length).split(':')[0];
  return /^\d{8,15}$/.test(numero) ? numero : null;
}
