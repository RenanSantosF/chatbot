import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Só pra conferir a assinatura; quem emite o token é o AuthModule. */
const conferidor = new JwtService();

function tokenDaRequisicao(req: Record<string, any>): string | null {
  const cookie = (req.cookies as Record<string, string> | undefined)
    ?.access_token;
  if (cookie) return cookie;
  const cabecalho = (req.headers as Record<string, string | undefined>)
    ?.authorization;
  return cabecalho?.startsWith('Bearer ') ? cabecalho.slice(7) : null;
}

/**
 * O limite de requisições conta por PESSOA logada, e não por IP.
 *
 * O painel chega à API passando pelo Next e pela borda do Railway, e a
 * API enxerga o mesmo endereço pra todo mundo. Contando por IP, todas as
 * empresas dividiam um balde só de 300 chamadas por minuto — e um Inbox
 * aberto dispara dezenas. Bastavam algumas pessoas atendendo ao mesmo
 * tempo pra o painel inteiro começar a responder "muitas requisições".
 *
 * O token é CONFERIDO (assinatura e validade), não só lido: sem isso,
 * quem quisesse fugir do limite inventaria um `sub` novo a cada chamada.
 * Quem não está logado cai no mesmo problema do IP único, e por isso é
 * contado pelo que a própria requisição diz de quem é:
 *
 * - Pelo E-MAIL em entrar, cadastrar e esqueci a senha. Por IP, dez
 *   pessoas entrando no painel às 8h da manhã esgotavam o login de todas
 *   as empresas. Por e-mail, quem tenta adivinhar a senha de uma conta
 *   continua barrado nela — que é o que o limite existe pra fazer.
 * - Pelo VISITANTE no rastreio da landing. Por IP, o dia do lançamento
 *   (justamente quando o funil importa) perdia os eventos depois dos
 *   primeiros visitantes do minuto.
 */
@Injectable()
export class LimitePorUsuarioGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, any>,
  ): Promise<string> {
    const token = tokenDaRequisicao(req);
    const segredo = process.env.JWT_SECRET;
    if (token && segredo) {
      try {
        const { sub } = conferidor.verify<{ sub?: string }>(token, {
          secret: segredo,
        });
        if (sub) return `usuario:${sub}`;
      } catch {
        // Token vencido ou forjado: conta como anônimo.
      }
    }

    const ip = await super.getTracker(req);
    const corpo = req.body as Record<string, unknown> | undefined;
    if (typeof corpo?.email === 'string' && corpo.email.trim()) {
      return `${ip}|email:${corpo.email.trim().toLowerCase().slice(0, 200)}`;
    }
    if (typeof corpo?.visitante === 'string' && corpo.visitante) {
      return `${ip}|visitante:${corpo.visitante.slice(0, 100)}`;
    }
    return ip;
  }
}
