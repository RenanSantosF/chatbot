import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { slugify } from '../../common/utils/slugify';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Gera um slug único a partir do nome da empresa, adicionando sufixo se já existir. */
  async generateUniqueSlug(companyName: string): Promise<string> {
    const base = slugify(companyName) || 'empresa';
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
