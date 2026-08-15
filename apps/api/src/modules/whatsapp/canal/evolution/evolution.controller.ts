import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { RequiresPermission } from '../../../../common/auth/permission.decorator';
import { ConectarEvolutionDto } from './dto/conectar-evolution.dto';
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

  @Post()
  @RequiresPermission('whatsapp.manage')
  conectar(@Body() dto: ConectarEvolutionDto) {
    return this.evolution.conectar(dto);
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
