import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res, UnauthorizedException } from '@nestjs/common';
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

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    this.setSessionCookie(res, result.accessToken);
    return this.toResponseBody(result);
  }

  @Public()
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
    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: user.tenantId } });
    if (!tenant) {
      throw new UnauthorizedException();
    }

    return {
      user: { id: user.userId, name: user.name, email: user.email, role: user.role },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    };
  }
}
