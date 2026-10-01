import type { Request } from 'express';
import type { UserRole } from '../../../generated/prisma/client';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: UserRole;
  /** Quando o token foi emitido (segundos) — o jwt preenche sozinho. */
  iat?: number;
}

export interface RequestUser {
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
  name: string;
}

export interface AuthenticatedRequest extends Request {
  user?: RequestUser;
}
