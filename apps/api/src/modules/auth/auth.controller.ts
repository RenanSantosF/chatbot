import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Public } from '../../common/auth/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService, type AuthResult } from './auth.service';
import type { RequestUser } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const ACCESS_TOKEN_COOKIE = 'access_token';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  private setSessionCookie(res: Response, token: string) {
    res.cookie(ACCESS_TOKEN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SEVEN_DAYS_MS,
      path: '/',
    });
  }

  private toResponseBody(result: AuthResult) {
    // O token também vai no corpo pra clientes que preferem Authorization
    // header (ex: apps mobile futuros); o cookie httpOnly é o caminho
    // principal pro frontend web.
    const { accessToken, ...rest } = result;
    return { ...rest, accessToken };
  }

  /**
   * Cinco por minuto. Criar empresa é ato raro — quem faz isso em rajada
   * está enchendo o banco de tenants, não abrindo negócio.
   */
  @Public()
  @Throttle({ curto: { ttl: seconds(60), limit: 5 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    this.setSessionCookie(res, result.accessToken);
    return this.toResponseBody(result);
  }

  /**
   * Dez tentativas por minuto, por IP.
   *
   * É o teto que separa "errei a senha e tentei de novo" de "estou testando
   * uma lista de senhas". Dez cabe folgado no primeiro caso e torna o
   * segundo inviável: uma senha fraca de seis dígitos levaria mais de dois
   * meses nesse ritmo.
   *
   * O balde é por IP, então não dá pra travar a conta de alguém de fora —
   * quem exagera trava a si mesmo.
   */
  @Public()
  @Throttle({ curto: { ttl: seconds(60), limit: 10 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    this.setSessionCookie(res, result.accessToken);
    return this.toResponseBody(result);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('socket-token')
  socketToken(@CurrentUser() user: RequestUser) {
    return { token: this.authService.issueSocketToken(user) };
  }

  @Get('me')
  async me(@CurrentUser() user: RequestUser) {
    const [tenant, account] = await Promise.all([
      this.prisma.client.tenant.findUnique({ where: { id: user.tenantId } }),
      this.prisma.client.user.findUnique({
        where: { id: user.userId },
        select: { name: true, mustChangePassword: true },
      }),
    ]);
    if (!tenant || !account) {
      throw new UnauthorizedException();
    }

    return {
      user: {
        id: user.userId,
        // Vem do banco, não do JWT: o token carrega o nome de quando foi
        // emitido, então sem isso o painel continuaria mostrando o nome
        // antigo até a sessão expirar depois de uma edição de perfil.
        name: account.name,
        email: user.email,
        role: user.role,
        mustChangePassword: account.mustChangePassword,
      },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    };
  }
}
