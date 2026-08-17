import { Controller, Delete, Get, Post } from '@nestjs/common';
import { RequiresPermission } from '../../../../common/auth/permission.decorator';
import { EvolutionService } from './evolution.service';

/**
 * A tela de conectar o WhatsApp sem passar pela Meta.
 *
 * Mesma permissão do WhatsApp oficial (`whatsapp.manage`): pra quem usa, é
 * a mesma decisão — qual número atende os clientes desta empresa.
 */
@Controller('whatsapp/evolution')
export class EvolutionController {
  constructor(private readonly evolution: EvolutionService) {}

  @Get()
  status() {
    return this.evolution.status();
  }

  /**
   * Sem corpo, de propósito.
   *
   * Já recebeu endereço do servidor e chave da API, e os dois saíram: são
   * infraestrutura da plataforma, não configuração do cliente. O motivo
   * mais forte é de segurança — a chave da Evolution é global, e quem a
   * tem apaga a sessão de QUALQUER empresa do servidor (ver
   * evolution-servidor.ts).
   */
  @Post()
  @RequiresPermission('whatsapp.manage')
  conectar() {
    return this.evolution.conectar();
  }

  /** O QR code expira em cerca de um minuto; a tela pede outro. */
  @Post('qrcode')
  @RequiresPermission('whatsapp.manage')
  renovarQrCode() {
    return this.evolution.renovarQrCode();
  }

  @Get('conferir')
  @RequiresPermission('whatsapp.manage')
  conferir() {
    return this.evolution.conferir();
  }

  @Delete()
  @RequiresPermission('whatsapp.manage')
  desconectar() {
    return this.evolution.desconectar();
  }
}
