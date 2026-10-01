import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Public } from '../../common/auth/public.decorator';
import { BillingExempt } from '../../common/billing/billing-exempt.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { AuthService, type AuthResult } from './auth.service';
import type { RequestUser } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import {
  ConferirRedefinicaoDto,
  PedirRedefinicaoDto,
  RedefinirSenhaDto,
} from './dto/redefinicao-de-senha.dto';
import { RedefinicaoDeSenhaService } from './redefinicao-de-senha.service';
import { EstadoDoCanalService } from '../whatsapp/canal/estado-do-canal.service';
import { ehDaPlataforma } from '../plataforma/plataforma.guard';
import {
  RegistroDeEventos,
  dia,
} from '../plataforma/registro-de-eventos.service';

/**
 * Quando cada pessoa teve o acesso registrado pela última vez.
 *
 * `/auth/me` roda a cada página aberta do painel; registrar em todas seria
 * uma escrita no banco por clique. Uma vez por hora por pessoa basta pra
 * "último acesso" e pra contar quem usou no dia.
 */
const acessoRegistradoEm = new Map<string, number>();
const HORA_MS = 60 * 60 * 1000;

const ACCESS_TOKEN_COOKIE = 'access_token';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly estadoDoCanal: EstadoDoCanalService,
    private readonly billing: BillingService,
    private readonly eventos: RegistroDeEventos,
    private readonly redefinicao: RedefinicaoDeSenhaService,
  ) {}

  /**
   * "Esqueci minha senha". Três por minuto por IP: cada pedido manda um
   * e-mail, e e-mail em rajada pra caixa de alguém é assédio, não
   * esquecimento.
   *
   * Responde igual exista ou não a conta (ver RedefinicaoDeSenhaService).
   */
  @Public()
  @Throttle({ curto: { ttl: seconds(60), limit: 3 } })
  @Post('esqueci-senha')
  @HttpCode(HttpStatus.OK)
  async esqueciSenha(@Body() dto: PedirRedefinicaoDto) {
    await this.redefinicao.pedir(dto.email);
    return { ok: true };
  }

  @Public()
  @Throttle({ curto: { ttl: seconds(60), limit: 20 } })
  @Post('redefinir-senha/conferir')
  @HttpCode(HttpStatus.OK)
  conferirRedefinicao(@Body() dto: ConferirRedefinicaoDto) {
    return this.redefinicao.conferir(dto.token);
  }

  @Public()
  @Throttle({ curto: { ttl: seconds(60), limit: 10 } })
  @Post('redefinir-senha')
  @HttpCode(HttpStatus.OK)
  async redefinirSenha(@Body() dto: RedefinirSenhaDto) {
    await this.redefinicao.redefinir(dto.token, dto.senha);
    return { ok: true };
  }

  /** O acesso ao painel, pro painel da plataforma. Não segura a resposta. */
  private registrarAcesso(user: RequestUser) {
    const agora = Date.now();
    if (agora - (acessoRegistradoEm.get(user.userId) ?? 0) < HORA_MS) return;
    acessoRegistradoEm.set(user.userId, agora);

    void this.eventos.registrar('painel_acesso', {
      tenantId: user.tenantId,
      userId: user.userId,
      chave: `acesso:${user.userId}:${dia()}`,
    });
    void this.prisma.client.user
      .update({
        where: { id: user.userId },
        data: { ultimoAcessoEm: new Date(agora) },
      })
      .catch(() => {});
  }

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
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
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
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
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

  @BillingExempt()
  @Get('socket-token')
  socketToken(@CurrentUser() user: RequestUser) {
    return { token: this.authService.issueSocketToken(user) };
  }

  /**
   * `@BillingExempt()`: é a chamada que o painel usa pra DESCOBRIR que a
   * empresa está bloqueada (`cobranca` abaixo) e mostrar a tela de
   * pagamento — bloquear a própria chamada deixaria a pessoa presa numa
   * tela em branco, sem saber por quê.
   */
  @BillingExempt()
  @Get('me')
  async me(@CurrentUser() user: RequestUser) {
    const [tenant, account, canal, cobranca, espaco, limpeza] =
      await Promise.all([
        this.prisma.client.tenant.findUnique({ where: { id: user.tenantId } }),
        this.prisma.client.user.findUnique({
          where: { id: user.userId },
          select: {
            name: true,
            mustChangePassword: true,
            tourVistoEm: true,
            usouCorrecaoEm: true,
          },
        }),
        // O estado do WhatsApp vem JUNTO com a sessão, e não só por evento
        // de tempo real. Sem isto, quem abria o painel com a sessão já caída
        // não via aviso nenhum — o evento tinha passado antes de a página
        // existir, e a faixa só aparecia por acaso, se a sessão oscilasse
        // com a aba aberta.
        this.estadoDoCanal.doTenant(user.tenantId),
        this.billing.status(),
        // O último número medido (a varredura e a tela de armazenamento
        // mantêm em dia), não uma medição nova a cada tela aberta.
        this.prisma.client.billingAccount.findFirst({
          where: { tenantId: user.tenantId },
          select: { usedBytes: true, quotaBytes: true },
        }),
        this.prisma.client.retentionSettings.findFirst({
          where: { tenantId: user.tenantId },
          select: { autoPurgeOnFull: true },
        }),
      ]);
    if (!tenant || !account) {
      throw new UnauthorizedException();
    }

    this.registrarAcesso(user);

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
        tourVisto: account.tourVistoEm !== null,
        // Já usou a correção por IA: a dica do atalho não aparece mais.
        usouCorrecao: account.usouCorrecaoEm !== null,
      },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      canal,
      cobranca,
      // Pro aviso de "armazenamento quase cheio" do painel.
      armazenamento: espaco
        ? {
            usadoBytes: Number(espaco.usedBytes),
            cotaBytes: Number(espaco.quotaBytes),
            limpezaAutomatica: limpeza?.autoPurgeOnFull ?? false,
          }
        : null,
      // Mostra o painel da plataforma no menu. A proteção de verdade é o
      // PlataformaGuard na API; isto só decide se o item aparece.
      plataforma: ehDaPlataforma(user.email),
    };
  }

  /**
   * A pessoa terminou ou pulou o tour guiado: não mostra mais, em nenhum
   * navegador. Só grava a primeira vez — refazer o tour pelo botão de
   * ajuda não mexe na data.
   */
  @BillingExempt()
  @Post('tour-visto')
  @HttpCode(HttpStatus.NO_CONTENT)
  async tourVisto(@CurrentUser() user: RequestUser) {
    await this.prisma.client.user.updateMany({
      where: { id: user.userId, tourVistoEm: null },
      data: { tourVistoEm: new Date() },
    });
  }
}
