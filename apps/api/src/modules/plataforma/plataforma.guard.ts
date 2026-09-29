import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';

/**
 * Quem é dono da plataforma — definido por variável de ambiente, e não
 * por um papel no banco.
 *
 * Papel no banco seria mais uma coisa que uma falha de permissão em outra
 * tela poderia conceder. A lista vem do servidor (`PLATFORM_ADMIN_EMAILS`,
 * separados por vírgula), e só quem tem acesso ao Railway muda.
 */
export function emailsDaPlataforma(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function ehDaPlataforma(email: string | null | undefined): boolean {
  if (!email) return false;
  return emailsDaPlataforma().includes(email.trim().toLowerCase());
}

@Injectable()
export class PlataformaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!ehDaPlataforma(req.user?.email)) {
      // 403 genérico: não confirma que a rota existe nem pra quem é.
      throw new ForbiddenException();
    }
    return true;
  }
}
