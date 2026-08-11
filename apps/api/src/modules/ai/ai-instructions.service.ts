import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { CreateAiInstructionDto, UpdateAiInstructionDto } from './dto/ai-instruction.dto';

@Injectable()
export class AiInstructionsService {
  constructor(private readonly prisma: TenantPrismaService) {}

  list() {
    return this.prisma.db.aiInstruction.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] });
  }

  async create(dto: CreateAiInstructionDto) {
    return this.prisma.db.aiInstruction.create({
      data: { tenantId: this.prisma.tenantId, ...dto },
    });
  }

  private async requireOwn(id: string) {
    const instruction = await this.prisma.db.aiInstruction.findFirst({ where: { id } });
    if (!instruction) {
      throw new NotFoundException('Instrução não encontrada.');
    }
    return instruction;
  }

  async update(id: string, dto: UpdateAiInstructionDto) {
    await this.requireOwn(id);
    return this.prisma.db.aiInstruction.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.requireOwn(id);
    await this.prisma.db.aiInstruction.delete({ where: { id } });
    return { ok: true };
  }
}
