import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { ParsedContact } from './contact-import';

interface FindOrCreateInput {
  phone: string;
  name: string;
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

@Injectable()
export class CustomersService {
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
      where: busca
        ? {
            OR: [
              { name: { contains: busca, mode: 'insensitive' } },
              // Sem `mode` no telefone: são só dígitos, e a comparação
              // insensível a maiúsculas custaria sem mudar resultado.
              { phone: { contains: busca } },
            ],
          }
        : {},
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
  async upsertFromAddressBook(input: {
    phone: string;
    name?: string;
    /**
     * O nome veio da AGENDA do aparelho, e não de um apelido que a pessoa
     * escolheu pra si.
     *
     * Quando vem de lá, ele ganha de qualquer coisa que já esteja
     * gravada: é o nome que a empresa usa pra falar dessa pessoa no dia a
     * dia, e é o único que conserta um registro que nasceu torto.
     */
    daAgenda?: boolean;
  }) {
    const nome = input.name?.trim();

    const existing = await this.prisma.db.customer.findFirst({
      where: { phone: input.phone },
    });

    if (!existing) {
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

  async findOrCreateByPhone({ phone, name }: FindOrCreateInput) {
    const existing = await this.prisma.db.customer.findFirst({ where: { phone } });
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.db.customer.create({
        data: { tenantId: this.prisma.tenantId, phone, name },
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
