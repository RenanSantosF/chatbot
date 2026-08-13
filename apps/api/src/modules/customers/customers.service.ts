import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { ParsedContact } from './contact-import';

interface FindOrCreateInput {
  phone: string;
  name: string;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: TenantPrismaService) {}

  async list() {
    return this.prisma.db.customer.findMany({ orderBy: { createdAt: 'desc' } });
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
  async upsertFromAddressBook(input: { phone: string; name?: string }) {
    const existing = await this.prisma.db.customer.findFirst({
      where: { phone: input.phone },
    });

    if (!existing) {
      return this.prisma.db.customer.create({
        data: {
          tenantId: this.prisma.tenantId,
          phone: input.phone,
          name: input.name?.trim() || input.phone,
        },
      });
    }

    const semNomeDeVerdade = !existing.name?.trim() || existing.name === existing.phone;
    if (input.name?.trim() && semNomeDeVerdade) {
      return this.prisma.db.customer.update({
        where: { id: existing.id },
        data: { name: input.name.trim() },
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
