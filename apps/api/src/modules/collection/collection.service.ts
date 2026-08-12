import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { slugify } from '../../common/utils/slugify';
import type {
  CreateCollectionFieldDto,
  UpdateCollectionFieldDto,
} from './dto/collection-field.dto';

/** Dica de formato que entra na descrição da ferramenta pra a IA. */
const TYPE_HINT: Record<string, string> = {
  TEXT: 'texto livre',
  EMAIL: 'e-mail válido',
  PHONE: 'telefone com DDD',
  DOCUMENT: 'documento (CPF/CNPJ), só os números',
  DATE: 'data no formato DD/MM/AAAA',
  NUMBER: 'número',
};

@Injectable()
export class CollectionService {
  constructor(private readonly prisma: TenantPrismaService) {}

  list() {
    return this.prisma.db.collectionField.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async uniqueKey(label: string): Promise<string> {
    const base = slugify(label) || 'campo';
    let candidate = base;
    let attempt = 1;
    while (
      await this.prisma.db.collectionField.findFirst({ where: { key: candidate } })
    ) {
      attempt += 1;
      candidate = `${base}-${attempt}`;
    }
    return candidate;
  }

  async create(dto: CreateCollectionFieldDto) {
    const key = await this.uniqueKey(dto.label);
    const count = await this.prisma.db.collectionField.count();

    return this.prisma.db.collectionField.create({
      data: {
        tenantId: this.prisma.tenantId,
        key,
        label: dto.label,
        description: dto.description,
        type: dto.type ?? 'TEXT',
        target: dto.target ?? 'METADATA',
        required: dto.required ?? true,
        order: count,
      },
    });
  }

  async update(id: string, dto: UpdateCollectionFieldDto) {
    await this.require(id);
    return this.prisma.db.collectionField.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.require(id);
    await this.prisma.db.collectionField.delete({ where: { id } });
    return { ok: true };
  }

  private async require(id: string) {
    const field = await this.prisma.db.collectionField.findFirst({ where: { id } });
    if (!field) {
      throw new NotFoundException('Campo não encontrado.');
    }
    return field;
  }

  private activeFields() {
    return this.prisma.db.collectionField.findMany({
      where: { active: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Descrição dos campos pra montar a declaração da ferramenta da IA. */
  async describeForAi() {
    const fields = await this.activeFields();
    return fields.map((field) => ({
      key: field.key,
      label: field.label,
      required: field.required,
      hint: [field.description, TYPE_HINT[field.type]].filter(Boolean).join(' — '),
    }));
  }

  /**
   * O que ainda falta coletar nesta conversa. É isso que permite bloquear a
   * transferência: em vez de confiar que o modelo lembrou de perguntar, o
   * sistema confere o que está gravado e devolve a lista do que falta.
   */
  async missingRequired(conversationId: string): Promise<string[]> {
    const fields = await this.activeFields();
    const required = fields.filter((field) => field.required);
    if (required.length === 0) return [];

    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId },
      select: {
        collectedData: true,
        customer: { select: { name: true, email: true, metadata: true } },
      },
    });
    if (!conversation) return [];

    const collected = asRecord(conversation.collectedData);
    const stored = asRecord(conversation.customer.metadata);

    return required
      .filter((field) => {
        if (field.target === 'NAME') {
          // O nome que veio do perfil do WhatsApp não conta como coletado
          // se for só o número — é o caso de quem não tem nome no perfil.
          const name = conversation.customer.name?.trim() ?? '';
          return !name || /^\+?\d[\d\s-]*$/.test(name);
        }
        if (field.target === 'EMAIL') {
          return !conversation.customer.email;
        }
        return !collected[field.key] && !stored[field.key];
      })
      .map((field) => field.label);
  }

  /**
   * Grava o que a IA coletou. Campos com destino NAME/EMAIL sobem pro
   * cadastro do cliente — é o que faz o contato deixar de se chamar
   * "5511999..." e passar a ter o nome de verdade.
   */
  async save(conversationId: string, values: Record<string, string>) {
    const fields = await this.activeFields();
    const byKey = new Map(fields.map((field) => [field.key, field]));

    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId },
      select: {
        id: true,
        customerId: true,
        collectedData: true,
        customer: { select: { metadata: true } },
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    const customerUpdate: { name?: string; email?: string } = {};
    const metadata = asRecord(conversation.customer.metadata);
    const collected = asRecord(conversation.collectedData);

    for (const [key, rawValue] of Object.entries(values)) {
      const value = String(rawValue ?? '').trim();
      if (!value) continue;

      const field = byKey.get(key);
      collected[key] = value;

      if (field?.target === 'NAME') customerUpdate.name = value;
      else if (field?.target === 'EMAIL') customerUpdate.email = value;
      else metadata[key] = value;
    }

    await this.prisma.db.conversation.update({
      where: { id: conversation.id },
      data: { collectedData: collected as Prisma.InputJsonValue },
    });

    await this.prisma.db.customer.update({
      where: { id: conversation.customerId },
      data: { ...customerUpdate, metadata: metadata as Prisma.InputJsonValue },
    });

    return {
      saved: Object.keys(values),
      missing: await this.missingRequired(conversationId),
    };
  }
}

function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || entry === undefined || typeof entry === 'object') continue;
    result[key] = String(entry);
  }
  return result;
}
