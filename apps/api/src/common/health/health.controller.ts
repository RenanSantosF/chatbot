import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * "Este servidor está de pé e consegue trabalhar?"
 *
 * Duas perguntas diferentes, e por isso duas rotas:
 *
 * - `/health` responde se o PROCESSO está vivo. Nunca toca no banco: se o
 *   Postgres cair, reiniciar a API não resolve nada, e um health check que
 *   falha junto faria a hospedagem matar e recriar o container em laço
 *   enquanto o problema está do outro lado.
 *
 * - `/health/ready` responde se ele consegue ATENDER, o que inclui o banco.
 *   É a que serve pra decidir se o tráfego pode entrar — durante um deploy,
 *   por exemplo, antes das migrações terminarem.
 *
 * Pública e fora do limite de requisições de propósito: quem chama é a
 * infraestrutura, a cada poucos segundos, e ela não tem sessão.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  vivo() {
    return {
      status: 'ok',
      // Sobe junto porque é a primeira pergunta de toda investigação: o
      // servidor que está respondendo é o do commit novo ou o antigo?
      commit: (
        process.env.RAILWAY_GIT_COMMIT_SHA ??
        process.env.GIT_COMMIT ??
        'desconhecido'
      ).slice(0, 8),
      // Segundos de pé. Um número que reinicia sozinho a cada poucos
      // minutos é o sintoma de um servidor em laço de reinicialização, que
      // de fora parece só "lentidão".
      uptime: Math.round(process.uptime()),
    };
  }

  @Public()
  @Get('ready')
  async pronto() {
    try {
      // A consulta mais barata que ainda prova que a conexão funciona.
      await this.prisma.client.$queryRaw`SELECT 1`;
      return { status: 'ok', banco: 'ok' };
    } catch (erro) {
      return {
        status: 'degradado',
        banco: erro instanceof Error ? erro.message : 'indisponível',
      };
    }
  }
}
