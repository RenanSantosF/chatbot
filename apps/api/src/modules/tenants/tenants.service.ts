import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  private slugify(name: string): string {
    const COMBINING_DIACRITICS = /[̀-ͯ]/g;
    return name
      .normalize('NFD')
      .replace(COMBINING_DIACRITICS, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
  }

  /** Gera um slug único a partir do nome da empresa, adicionando sufixo se já existir. */
  async generateUniqueSlug(companyName: string): Promise<string> {
    const base = this.slugify(companyName) || 'empresa';
    let candidate = base;
    let attempt = 1;

    // Tenant não é tenant-scoped (é a raiz), então o client unscoped é o correto aqui.
    while (await this.prisma.client.tenant.findUnique({ where: { slug: candidate } })) {
      attempt += 1;
      candidate = `${base}-${attempt}`;
    }

    return candidate;
  }

  async findById(tenantId: string) {
    return this.prisma.client.tenant.findUnique({ where: { id: tenantId } });
  }
}
