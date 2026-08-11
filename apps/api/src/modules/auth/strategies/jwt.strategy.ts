import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload, RequestUser } from '../auth.types';

function extractFromCookie(req: Request): string | null {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.access_token;
  return token ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        extractFromCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  /**
   * Reconsulta o usuário a cada requisição (em vez de confiar cegamente no
   * payload do token) — garante que um usuário desativado ou removido perde
   * acesso imediatamente, mesmo com um token ainda válido.
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || user.status !== 'ACTIVE' || user.tenantId !== payload.tenantId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    return {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
      name: user.name,
    };
  }
}
