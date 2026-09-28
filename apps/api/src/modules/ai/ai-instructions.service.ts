import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import {
  LIMITE_DE_REGRAS_ATIVAS,
  ORCAMENTO_DAS_REGRAS,
  pesoDaRegra,
} from './ai-context';
import type {
  CreateAiInstructionDto,
  UpdateAiInstructionDto,
} from './dto/ai-instruction.dto';

@Injectable()
export class AiInstructionsService {
  constructor(private readonly prisma: TenantPrismaService) {}

  list() {
    return this.prisma.db.aiInstruction.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Recusa a regra ativa que passaria do teto.
   *
   * No cadastro, e não só na montagem do prompt: lá a regra que não cabe
   * é pulada em silêncio, e a empresa acharia que a IA está ignorando o
   * que ela ensinou. Aqui ela fica sabendo na hora, com os números.
   */
  private async conferirOrcamento(
    nova: { title: string; content: string },
    excetoId?: string,
  ) {
    const outras = await this.prisma.db.aiInstruction.findMany({
      where: { active: true, ...(excetoId ? { id: { not: excetoId } } : {}) },
      select: { title: true, content: true },
    });

    if (outras.length + 1 > LIMITE_DE_REGRAS_ATIVAS) {
      throw new BadRequestException(
        `Já há ${LIMITE_DE_REGRAS_ATIVAS} regras ativas, o máximo. Desative ou junte regras parecidas antes de criar outra.`,
      );
    }

    const emUso = outras.reduce((soma, regra) => soma + pesoDaRegra(regra), 0);
    const total = emUso + pesoDaRegra(nova);
    if (total > ORCAMENTO_DAS_REGRAS) {
      throw new BadRequestException(
        `As regras ativas passariam de ${ORCAMENTO_DAS_REGRAS} caracteres (ficariam com ${total}). ` +
          'Encurte esta regra, desative alguma, ou leve o texto longo pra um documento na base de conhecimento.',
      );
    }
  }

  async create(dto: CreateAiInstructionDto) {
    await this.conferirOrcamento(dto);
    return this.prisma.db.aiInstruction.create({
      data: { tenantId: this.prisma.tenantId, ...dto },
    });
  }

  private async requireOwn(id: string) {
    const instruction = await this.prisma.db.aiInstruction.findFirst({
      where: { id },
    });
    if (!instruction) {
      throw new NotFoundException('Instrução não encontrada.');
    }
    return instruction;
  }

  async update(id: string, dto: UpdateAiInstructionDto) {
    const atual = await this.requireOwn(id);
    const ficaAtiva = dto.active ?? atual.active;
    // Desativar ou mexer só na prioridade nunca pode ser barrado — é
    // justamente o caminho de quem está tentando voltar pro limite.
    const pesaMais =
      ficaAtiva &&
      (!atual.active || dto.title !== undefined || dto.content !== undefined);
    if (pesaMais) {
      await this.conferirOrcamento(
        {
          title: dto.title ?? atual.title,
          content: dto.content ?? atual.content,
        },
        id,
      );
    }
    return this.prisma.db.aiInstruction.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.requireOwn(id);
    await this.prisma.db.aiInstruction.delete({ where: { id } });
    return { ok: true };
  }
}
