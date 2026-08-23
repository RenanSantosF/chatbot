import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Req,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { PushService } from './push.service';

class InscreverDto {
  /**
   * A URL do serviço de push do navegador. Longa e opaca — o teto alto é
   * porque cada navegador usa um formato diferente e nenhum documenta um
   * tamanho máximo.
   */
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  endpoint!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(300)
  p256dh!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(300)
  auth!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  userAgent?: string;
}

class DesinscreverDto {
  @IsString()
  @MaxLength(1000)
  endpoint!: string;
}

/**
 * Onde o navegador se registra pra receber aviso com o painel fechado.
 *
 * Passa pelo guard padrão de propósito: a inscrição é amarrada ao usuário
 * logado e à empresa dele, e é isso que impede alguém de se inscrever pra
 * receber aviso de conversa de outra empresa.
 */
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /**
   * A chave pública que o navegador precisa pra se inscrever.
   *
   * Vem da API, e não de uma variável embutida no site: `NEXT_PUBLIC_*` é
   * congelada no `next build`, então trocar o par de chaves exigiria um
   * build novo do painel. Por aqui basta reiniciar a API.
   *
   * Devolve `null` quando o recurso está desligado (sem VAPID configurado)
   * — a tela usa isso pra não oferecer um botão que não vai funcionar.
   */
  @Get('chave')
  chave() {
    return { chavePublica: this.push.chavePublica() };
  }

  @Post('inscrever')
  async inscrever(@Body() dto: InscreverDto, @Req() req: AuthenticatedRequest) {
    const user = req.user;
    if (!user) throw new BadRequestException('Sessão inválida.');

    await this.push.inscrever({
      tenantId: user.tenantId,
      userId: user.userId,
      endpoint: dto.endpoint,
      p256dh: dto.p256dh,
      auth: dto.auth,
      userAgent: dto.userAgent,
    });
    return { ok: true };
  }

  /**
   * Sem conferir de quem é a inscrição, e isso é deliberado.
   *
   * O `endpoint` é um segredo do próprio aparelho — quem o tem é porque
   * está nele. Exigir que o dono fosse o mesmo impediria o caso real de um
   * computador compartilhado em que o atendente anterior esqueceu de sair:
   * o próximo desliga o aviso e ele para de tocar, que é o resultado certo.
   */
  @Delete('inscrever')
  async desinscrever(@Body() dto: DesinscreverDto) {
    await this.push.desinscrever(dto.endpoint);
    return { ok: true };
  }
}
