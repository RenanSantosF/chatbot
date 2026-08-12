import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

const PASSWORD_SALT_ROUNDS = 12;
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

const teamSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  avatar: true,
  createdAt: true,
} as const;

function generateTemporaryPassword(): string {
  return randomBytes(9).toString('base64url');
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: TenantPrismaService) {}

  /**
   * Não recebe tenantId por parâmetro de propósito: TenantPrismaService já
   * sabe o tenant da requisição atual e filtra tudo automaticamente. Chamar
   * isso fora de uma requisição autenticada lança erro, não retorna dado de
   * outra empresa.
   */
  async listTeam() {
    return this.prisma.db.user.findMany({
      select: teamSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Sem infraestrutura de e-mail ainda — o dono cria a conta direto com uma
   * senha temporária gerada aqui, mostrada uma única vez na resposta (nunca
   * fica recuperável depois), e repassa pro colaborador por fora (WhatsApp,
   * verbalmente, etc). Nunca cria como OWNER: só existe um dono por tenant,
   * o que registrou a empresa.
   */
  async create(dto: CreateUserDto) {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(
      temporaryPassword,
      PASSWORD_SALT_ROUNDS,
    );

    try {
      const user = await this.prisma.db.user.create({
        data: {
          tenantId: this.prisma.tenantId,
          name: dto.name,
          email: dto.email,
          passwordHash,
          role: dto.role,
          status: 'ACTIVE',
        },
        select: teamSelect,
      });
      return { user, temporaryPassword };
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException(
          'Já existe um usuário com este e-mail na plataforma.',
        );
      }
      throw error;
    }
  }

  private async requireTeamMember(id: string) {
    const user = await this.prisma.db.user.findFirst({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    return user;
  }

  /**
   * O dono nunca é alvo aqui (não dá pra rebaixar/desativar o único OWNER
   * por essa via) e ninguém consegue mexer na própria conta por aqui — evita
   * o dono se autodesativar por engano e ficar trancado pra fora.
   */
  async update(id: string, dto: UpdateUserDto, actingUserId: string) {
    if (id === actingUserId) {
      throw new BadRequestException(
        'Você não pode alterar a própria conta por aqui.',
      );
    }

    const target = await this.requireTeamMember(id);
    if (target.role === 'OWNER') {
      throw new ForbiddenException('O dono da empresa não pode ser alterado.');
    }

    return this.prisma.db.user.update({
      where: { id },
      data: dto,
      select: teamSelect,
    });
  }
}
