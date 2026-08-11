import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type { JwtPayload } from './auth.types';

const PASSWORD_SALT_ROUNDS = 12;

export interface AuthResult {
  accessToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly jwt: JwtService,
  ) {}

  private issueToken(payload: JwtPayload): string {
    return this.jwt.sign(payload);
  }

  /**
   * Cria a empresa (tenant) e seu primeiro usuário (OWNER) atomicamente.
   * É o único fluxo do sistema que cria um tenant do zero — por isso usa o
   * client cru: ainda não existe uma requisição autenticada de onde extrair
   * um tenantId, o tenantId nasce aqui.
   */
  async register(dto: RegisterDto): Promise<AuthResult> {
    const existingUser = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('Já existe uma conta com este e-mail.');
    }

    const slug = await this.tenants.generateUniqueSlug(dto.companyName);
    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);

    // Tenant e usuário nascem juntos ou não nascem: sem isso, uma falha na
    // criação do usuário (ex: corrida de e-mail duplicado) deixaria um
    // tenant órfão, sem nenhum OWNER, no banco.
    const { tenant, user } = await this.prisma.client.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.companyName,
          slug,
          timezone: dto.timezone ?? 'America/Sao_Paulo',
          status: 'TRIAL',
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: dto.ownerName,
          email: dto.email,
          passwordHash,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });

      return { tenant, user };
    });

    const accessToken = this.issueToken({ sub: user.id, tenantId: tenant.id, role: user.role });

    return {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    };
  }

  /**
   * Login por e-mail é a única busca de usuário legitimamente feita sem
   * conhecer o tenant de antemão — é justamente o que descobre o tenant.
   */
  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
      include: { tenant: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    if (user.tenant.status === 'SUSPENDED') {
      throw new UnauthorizedException('A conta desta empresa está suspensa.');
    }

    const accessToken = this.issueToken({ sub: user.id, tenantId: user.tenantId, role: user.role });

    return {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug },
    };
  }
}
