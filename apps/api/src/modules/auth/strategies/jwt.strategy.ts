import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CacheCurto } from '../../../common/cache/cache-curto';
import type { JwtPayload, RequestUser } from '../auth.types';

function extractFromCookie(req: Request): string | null {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies
    ?.access_token;
  return token ?? null;
}

/**
 * Quem já foi conferido no banco, por alguns segundos.
 *
 * Toda chamada do painel passava por uma consulta ao usuário antes de
 * qualquer outra coisa — em fila, antes do trabalho de verdade. Um clique
 * no Inbox dispara várias chamadas, e cada uma pagava essa ida.
 *
 * Quinze segundos é o pior caso pra um acesso desligado ou um papel
 * rebaixado valer — e nem isso quando a mudança passa pelo painel, que
 * apaga a entrada na hora (ver `esquecerUsuario`).
 */
const usuariosValidados = new CacheCurto<RequestUser>(15_000);

/** Chamado por quem muda papel, status ou dados de um usuário. */
export function esquecerUsuario(userId: string) {
  usuariosValidados.esquecer(`${userId}:`);
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
    // Com a hora de emissão na chave: depois de uma redefinição de senha,
    // o token novo entra no cache e o antigo não pode pegar carona nele.
    const chave = `${payload.sub}:${payload.tenantId}:${payload.iat ?? 0}`;
    const lembrado = usuariosValidados.get(chave);
    if (lembrado) return lembrado;

    const user = await this.prisma.client.user.findUnique({
      where: { id: payload.sub },
    });

    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.tenantId !== payload.tenantId
    ) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    // Senha redefinida pelo e-mail derruba quem entrou antes dela.
    if (
      user.sessoesValidasDesde &&
      (payload.iat ?? 0) * 1000 < user.sessoesValidasDesde.getTime()
    ) {
      throw new UnauthorizedException('Sessão encerrada. Entre de novo.');
    }

    const validado: RequestUser = {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
      name: user.name,
    };
    usuariosValidados.set(chave, validado);
    return validado;
  }
}
