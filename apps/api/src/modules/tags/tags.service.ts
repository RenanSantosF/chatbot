import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { CreateTagDto, UpdateTagDto } from './dto/tag.dto';

/**
 * A paleta é fechada de propósito.
 *
 * Deixar escolher qualquer cor produz etiqueta ilegível em um dos dois
 * temas do painel — e o dono que escolheu não vai testar no tema que não
 * usa. Oito tons conferidos nos dois é mais escolha do que qualquer
 * operação precisa; a cor da etiqueta serve pra diferenciar de relance, não
 * pra combinar com a marca.
 */
export const CORES = [
  'cinza',
  'vermelho',
  'ambar',
  'verde',
  'azul',
  'roxo',
  'rosa',
  'ciano',
] as const;

export type CorDeEtiqueta = (typeof CORES)[number];

/** Espaços a mais na ponta viram etiqueta "duplicada" que ninguém enxerga. */
function limparNome(bruto: string): string {
  return bruto.trim().replace(/\s+/g, ' ').slice(0, 40);
}

@Injectable()
export class TagsService {
  constructor(private readonly prisma: TenantPrismaService) {}

  /**
   * Todas as etiquetas, com quantas conversas cada uma tem.
   *
   * A contagem vem junto porque é o que faz a tela de configuração ser
   * útil: apagar uma etiqueta é diferente quando ela está em três conversas
   * e quando está em trezentas.
   */
  async list() {
    const tags = await this.prisma.db.tag.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { conversations: true } } },
    });

    return tags.map(({ _count, ...tag }) => ({
      ...tag,
      conversationCount: _count.conversations,
    }));
  }

  async create(dto: CreateTagDto) {
    const name = limparNome(dto.name);
    if (!name) {
      throw new ConflictException('A etiqueta precisa de um nome.');
    }

    const existente = await this.prisma.db.tag.findFirst({ where: { name } });
    if (existente) {
      throw new ConflictException(`Já existe uma etiqueta chamada "${name}".`);
    }

    return this.prisma.db.tag.create({
      data: {
        tenantId: this.prisma.tenantId,
        name,
        color: dto.color ?? 'cinza',
      },
    });
  }

  async update(id: string, dto: UpdateTagDto) {
    await this.buscar(id);

    const name = dto.name !== undefined ? limparNome(dto.name) : undefined;
    if (name !== undefined) {
      if (!name) throw new ConflictException('A etiqueta precisa de um nome.');
      const conflito = await this.prisma.db.tag.findFirst({
        where: { name, id: { not: id } },
      });
      if (conflito) {
        throw new ConflictException(`Já existe uma etiqueta chamada "${name}".`);
      }
    }

    return this.prisma.db.tag.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      },
    });
  }

  /**
   * Apagar a etiqueta a tira de todas as conversas.
   *
   * O banco cuida disso pela cascata da ligação. É o comportamento certo:
   * uma etiqueta que sumiu da lista não pode continuar aparecendo em
   * conversa nenhuma, e o histórico da conversa não perde nada de real —
   * etiqueta é organização, não registro do atendimento.
   */
  async remove(id: string) {
    await this.buscar(id);
    await this.prisma.db.tag.delete({ where: { id } });
    return { ok: true };
  }

  /** Põe a etiqueta na conversa. Repetir não é erro — o resultado é o mesmo. */
  async marcar(conversationId: string, tagId: string) {
    await this.buscar(tagId);

    const ja = await this.prisma.db.conversationTag.findFirst({
      where: { conversationId, tagId },
    });
    if (ja) return ja;

    return this.prisma.db.conversationTag.create({
      data: { tenantId: this.prisma.tenantId, conversationId, tagId },
    });
  }

  async desmarcar(conversationId: string, tagId: string) {
    // `deleteMany` e não `delete`: tirar uma etiqueta que já não está lá é
    // o mesmo resultado que a pessoa queria, e não merece um erro.
    await this.prisma.db.conversationTag.deleteMany({
      where: { conversationId, tagId },
    });
    return { ok: true };
  }

  private async buscar(id: string) {
    const tag = await this.prisma.db.tag.findFirst({ where: { id } });
    if (!tag) throw new NotFoundException('Etiqueta não encontrada.');
    return tag;
  }
}
