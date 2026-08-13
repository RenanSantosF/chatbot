import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type {
  CreateCustomerNoteDto,
  UpdateCustomerNoteDto,
} from './dto/customer-note.dto';

const autorSelecionado = {
  author: { select: { id: true, name: true } },
} as const;

/**
 * Anotações e pendências sobre um cliente.
 *
 * Não é tarefa do sistema nem mensagem: é o bilhete que o atendimento cola
 * na ficha do cliente ("aguardando prazo de coleta das informações"). Vive
 * no cliente, e não na conversa, de propósito — o assunto acaba, a conversa
 * é encerrada, e a observação continua valendo pra próxima vez que essa
 * pessoa escrever.
 */
@Injectable()
export class CustomerNotesService {
  constructor(private readonly prisma: TenantPrismaService) {}

  /**
   * Pendências abertas primeiro, depois o resto por data. Quem abre a ficha
   * quer ver primeiro o que está travado, não o histórico.
   */
  async list(customerId: string) {
    return this.prisma.db.customerNote.findMany({
      where: { customerId },
      include: autorSelecionado,
      orderBy: [{ doneAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
    });
  }

  async create(customerId: string, authorId: string, dto: CreateCustomerNoteDto) {
    const cliente = await this.prisma.db.customer.findFirst({
      where: { id: customerId },
      select: { id: true },
    });
    if (!cliente) throw new NotFoundException('Cliente não encontrado.');

    return this.prisma.db.customerNote.create({
      data: {
        tenantId: this.prisma.tenantId,
        customerId,
        authorId,
        content: dto.content.trim(),
        isPending: dto.isPending ?? false,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      },
      include: autorSelecionado,
    });
  }

  async update(id: string, dto: UpdateCustomerNoteDto) {
    await this.exigir(id);

    return this.prisma.db.customerNote.update({
      where: { id },
      data: {
        ...(dto.content !== undefined ? { content: dto.content.trim() } : {}),
        ...(dto.isPending !== undefined ? { isPending: dto.isPending } : {}),
        ...(dto.dueAt !== undefined
          ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null }
          : {}),
        // `done` chega como booleano e vira carimbo de data: quem resolveu
        // precisa saber QUANDO foi resolvido, não só que foi.
        ...(dto.done !== undefined ? { doneAt: dto.done ? new Date() : null } : {}),
      },
      include: autorSelecionado,
    });
  }

  async remove(id: string) {
    await this.exigir(id);
    await this.prisma.db.customerNote.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Quantas pendências abertas cada cliente tem, pra lista de clientes
   * marcar quem está travado sem precisar de uma consulta por linha.
   */
  async pendingCounts(customerIds: string[]) {
    if (customerIds.length === 0) return {} as Record<string, number>;

    const linhas = await this.prisma.db.customerNote.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds }, isPending: true, doneAt: null },
      _count: { _all: true },
    });

    return Object.fromEntries(linhas.map((l) => [l.customerId, l._count._all]));
  }

  private async exigir(id: string) {
    const nota = await this.prisma.db.customerNote.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!nota) throw new NotFoundException('Anotação não encontrada.');
    return nota;
  }
}
