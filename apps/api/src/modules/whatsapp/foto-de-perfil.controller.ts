import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { FotoDePerfilService } from './foto-de-perfil.service';

/**
 * Mora aqui, e não no controlador de clientes, porque depende do canal do
 * WhatsApp — e o módulo do WhatsApp já importa o de clientes (a agenda do
 * aparelho vira cliente). O inverso fecharia um ciclo.
 *
 * Sem permissão específica: quem enxerga a conversa enxerga a cara do
 * cliente, e o escopo por empresa já vem do TenantPrismaService.
 */
@Controller('customers')
export class FotoDePerfilController {
  constructor(private readonly fotos: FotoDePerfilService) {}

  @Post(':id/foto')
  @HttpCode(HttpStatus.OK)
  atualizar(@Param('id') id: string, @Query('forcar') forcar?: string) {
    return this.fotos.atualizar(id, {
      forcar: forcar === '1' || forcar === 'true',
    });
  }
}
