import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type {
  CreateQuickReplyDto,
  UpdateQuickReplyDto,
} from './dto/quick-reply.dto';

/**
 * Normaliza o atalho pro que se digita de fato.
 *
 * Quem cadastra escreve "/Bom Dia", "bom dia" ou "BOMDIA" pensando na mesma
 * coisa; quem usa digita depressa, minúsculo e sem acento. Guardar a forma
 * canônica evita o pior resultado possível de um atalho: ele existir e não
 * ser encontrado.
 */
export function normalizarAtalho(bruto: string): string {
  return bruto
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

@Injectable()
export class QuickRepliesService {
  constructor(private readonly prisma: TenantPrismaService) {}

  /**
   * A lista inteira, mais usadas primeiro.
   *
   * Sem paginação de propósito: são dezenas, não milhares, e o painel
   * carrega tudo uma vez pra filtrar enquanto a pessoa digita — buscar no
   * servidor a cada tecla daria uma latência que um atalho de teclado não
   * pode ter.
   */
  list() {
    return this.prisma.db.quickReply.findMany({
      orderBy: [{ usageCount: 'desc' }, { shortcut: 'asc' }],
    });
  }

  async create(dto: CreateQuickReplyDto) {
    const shortcut = normalizarAtalho(dto.shortcut);
    if (!shortcut) {
      throw new ConflictException(
        'O atalho precisa ter pelo menos uma letra ou número.',
      );
    }

    const existente = await this.prisma.db.quickReply.findFirst({
      where: { shortcut },
    });
    if (existente) {
      throw new ConflictException(`Já existe uma resposta com /${shortcut}.`);
    }

    return this.prisma.db.quickReply.create({
      data: {
        tenantId: this.prisma.tenantId,
        shortcut,
        title: dto.title?.trim() || null,
        content: dto.content,
      },
    });
  }

  async update(id: string, dto: UpdateQuickReplyDto) {
    await this.buscar(id);

    const shortcut =
      dto.shortcut !== undefined ? normalizarAtalho(dto.shortcut) : undefined;
    if (shortcut !== undefined) {
      if (!shortcut) {
        throw new ConflictException(
          'O atalho precisa ter pelo menos uma letra ou número.',
        );
      }
      const conflito = await this.prisma.db.quickReply.findFirst({
        where: { shortcut, id: { not: id } },
      });
      if (conflito) {
        throw new ConflictException(`Já existe uma resposta com /${shortcut}.`);
      }
    }

    return this.prisma.db.quickReply.update({
      where: { id },
      data: {
        ...(shortcut !== undefined ? { shortcut } : {}),
        ...(dto.title !== undefined ? { title: dto.title.trim() || null } : {}),
        ...(dto.content !== undefined ? { content: dto.content } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.buscar(id);
    await this.prisma.db.quickReply.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Marca que a resposta foi usada.
   *
   * É o que ordena a lista. Falhar aqui não pode atrapalhar quem está
   * atendendo: o texto já foi inserido no compositor antes desta chamada
   * sair, e um contador que não subiu não é motivo pra mostrar erro.
   */
  async registrarUso(id: string) {
    await this.buscar(id);
    return this.prisma.db.quickReply.update({
      where: { id },
      data: { usageCount: { increment: 1 } },
    });
  }

  private async buscar(id: string) {
    const encontrada = await this.prisma.db.quickReply.findFirst({
      where: { id },
    });
    if (!encontrada) {
      throw new NotFoundException('Resposta rápida não encontrada.');
    }
    return encontrada;
  }
}
