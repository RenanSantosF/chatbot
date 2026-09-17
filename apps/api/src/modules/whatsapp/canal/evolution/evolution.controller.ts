import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { RequiresPermission } from '../../../../common/auth/permission.decorator';
import { PearEvolutionDto } from './dto/parear-evolution.dto';
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

  /**
   * `@RequiresPermission('whatsapp.manage')` aqui não é redundante com o
   * comentário da classe — faltava de verdade. `status()` devolve o QR
   * code e o pairingCode brutos (ver EvolutionService.status), que são
   * material de pareamento: quem tiver essa dupla consegue parear um
   * WhatsApp como se fosse o dono da conta. Sem a trava, qualquer papel
   * autenticado da empresa (inclusive atendente) lia isso batendo direto
   * na API, mesmo sem a tela de Configurações — que já é restrita —
   * aparecer pra ele. O estado "conectado/desconectado" que todo mundo
   * PRECISA ver (a faixa vermelha do painel) vem de outro lugar,
   * `EstadoDoCanalService` via `/auth/me`, que não expõe pareamento
   * nenhum.
   */
  @Get()
  @RequiresPermission('whatsapp.manage')
  status() {
    return this.evolution.status();
  }

  /**
   * O único dado que vem de quem usa: o telefone que vai atender.
   *
   * Endereço do servidor e chave da API já saíram daqui — são
   * infraestrutura da plataforma, e a chave é global, então pedi-la a cada
   * empresa entregava a cada cliente o poder de derrubar o WhatsApp dos
   * outros (ver evolution-servidor.ts).
   *
   * O número é o oposto disso: é informação dele, e serve pra pedir um
   * CÓDIGO de pareamento em vez do QR code. Sem número, segue por imagem,
   * como antes.
   */
  @Post()
  @RequiresPermission('whatsapp.manage')
  conectar(@Body() dto: PearEvolutionDto) {
    return this.evolution.conectar(dto.numero, dto.confirmarTrocaDeNumero);
  }

  /** O pareamento expira em cerca de um minuto; a tela pede outro. */
  @Post('qrcode')
  @RequiresPermission('whatsapp.manage')
  renovarQrCode(@Body() dto: PearEvolutionDto) {
    return this.evolution.renovarQrCode(dto.numero);
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
