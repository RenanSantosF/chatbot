import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { esquecerUsuario } from './strategies/jwt.strategy';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/** Quanto tempo o link vale. Curto: ele entra na conta. */
const VALIDADE_MS = 30 * 60 * 1000;
/** Um e-mail por minuto por pessoa — clicar três vezes não manda três. */
const INTERVALO_ENTRE_PEDIDOS_MS = 60 * 1000;
const PASSWORD_SALT_ROUNDS = 12;

/** Só o hash vai pro banco; o token cru só existe no e-mail. */
function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * "Esqueci minha senha".
 *
 * Sem isto, o DONO que esquecia a senha ficava trancado pra fora de algo
 * que paga: membros da equipe o dono redefine pelo painel, mas o dono não
 * tinha a quem pedir.
 *
 * O pedido responde igual exista ou não o e-mail — dizer "esse e-mail não
 * tem conta" entrega a lista de clientes pra quem quiser testar.
 */
@Injectable()
export class RedefinicaoDeSenhaService {
  private readonly logger = new Logger(RedefinicaoDeSenhaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private urlBase(): string {
    const bruto = process.env.WEB_APP_URL?.trim().replace(/\/+$/, '');
    return bruto || 'http://localhost:3000';
  }

  async pedir(emailInformado: string): Promise<void> {
    const email = emailInformado.trim().toLowerCase();
    const user = await this.prisma.client.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        tenant: { select: { status: true } },
      },
    });
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.tenant.status === 'SUSPENDED'
    ) {
      return;
    }

    const recente = await this.prisma.client.redefinicaoDeSenha.findFirst({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(Date.now() - INTERVALO_ENTRE_PEDIDOS_MS) },
      },
      select: { id: true },
    });
    if (recente) return;

    const token = randomBytes(32).toString('base64url');
    // Um link novo invalida os anteriores: só o último e-mail funciona.
    await this.prisma.client.$transaction([
      this.prisma.client.redefinicaoDeSenha.updateMany({
        where: { userId: user.id, usadoEm: null },
        data: { usadoEm: new Date() },
      }),
      this.prisma.client.redefinicaoDeSenha.create({
        data: {
          userId: user.id,
          tokenHash: hashDoToken(token),
          expiraEm: new Date(Date.now() + VALIDADE_MS),
        },
      }),
    ]);

    const link = `${this.urlBase()}/redefinir-senha?token=${token}`;
    const nome = user.name.split(' ')[0] || user.name;
    const enviado = await this.email.enviar({
      para: user.email,
      assunto: 'Redefinir sua senha da Bellis',
      texto: [
        `Olá, ${nome}!`,
        '',
        'Recebemos um pedido pra redefinir a senha da sua conta na Bellis.',
        `Pra criar uma senha nova, abra este link (vale por 30 minutos):`,
        link,
        '',
        'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
      ].join('\n'),
      html: `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#f6f7f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1f1c">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px">
    <p style="font-size:18px;font-weight:600;margin:0 0 24px">Bellis</p>
    <div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e4e7e5">
      <p style="margin:0 0 12px;font-size:16px">Olá, ${escapar(nome)}!</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#4a524d">Recebemos um pedido pra redefinir a senha da sua conta. Clique no botão pra criar uma senha nova — o link vale por 30 minutos.</p>
      <a href="${escapar(link)}" style="display:inline-block;background:#04A680;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">Criar senha nova</a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6b736e">Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>
    </div>
    <p style="margin:20px 0 0;font-size:12px;color:#8a918c;word-break:break-all">Se o botão não abrir, copie este endereço no navegador:<br>${escapar(link)}</p>
  </div>
</body></html>`,
    });
    if (!enviado) {
      this.logger.warn(
        `O e-mail de redefinição de senha não saiu (usuário ${user.id}).`,
      );
    }
  }

  /** O link ainda serve? A tela pergunta antes de mostrar o formulário. */
  async conferir(token: string): Promise<{ valido: boolean }> {
    return { valido: Boolean(await this.pedidoValido(token)) };
  }

  async redefinir(token: string, senha: string): Promise<void> {
    const pedido = await this.pedidoValido(token);
    if (!pedido) {
      throw new BadRequestException(
        'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".',
      );
    }

    const passwordHash = await bcrypt.hash(senha, PASSWORD_SALT_ROUNDS);
    // Segundos inteiros, como o `iat` do token: um login feito no mesmo
    // segundo da redefinição não pode cair do lado errado da linha.
    const agora = new Date(Math.floor(Date.now() / 1000) * 1000);

    const usado = await this.prisma.client.redefinicaoDeSenha.updateMany({
      where: { id: pedido.id, usadoEm: null },
      data: { usadoEm: agora },
    });
    // Duas abas confirmando o mesmo link: só a primeira vale.
    if (usado.count === 0) {
      throw new BadRequestException(
        'Este link já foi usado. Peça um novo em "Esqueci minha senha".',
      );
    }

    await this.prisma.client.user.update({
      where: { id: pedido.userId },
      data: {
        passwordHash,
        mustChangePassword: false,
        sessoesValidasDesde: agora,
      },
    });
    esquecerUsuario(pedido.userId);
    // Quem estava com o painel aberto com a senha antiga sai do tempo real
    // agora — o HTTP já recusa o token velho.
    this.realtime.derrubarPessoa(pedido.userId);
    this.logger.log(`Senha redefinida pelo e-mail (usuário ${pedido.userId}).`);
  }

  private async pedidoValido(token: string) {
    if (!token || token.length > 200) return null;
    const pedido = await this.prisma.client.redefinicaoDeSenha.findUnique({
      where: { tokenHash: hashDoToken(token) },
      select: {
        id: true,
        userId: true,
        expiraEm: true,
        usadoEm: true,
        user: { select: { status: true } },
      },
    });
    if (
      !pedido ||
      pedido.usadoEm ||
      pedido.expiraEm.getTime() < Date.now() ||
      pedido.user.status !== 'ACTIVE'
    ) {
      return null;
    }
    return pedido;
  }
}
