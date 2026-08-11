import { BadGatewayException, Body, Controller, Post } from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
import { AiEngineService } from './ai-engine.service';
import { SimulateDto } from './dto/simulate.dto';

@Controller('ai')
export class AiTestController {
  constructor(private readonly aiEngineService: AiEngineService) {}

  /** Simulador (/ai/test no frontend): testa o prompt atual sem criar conversa nem cliente. */
  @Post('simulate')
  @Roles('OWNER', 'ADMIN')
  async simulate(@Body() dto: SimulateDto) {
    try {
      const reply = await this.aiEngineService.simulate(dto.message);
      return { reply };
    } catch (error) {
      // Aqui o erro é sobre a CONFIGURAÇÃO da própria IA (chave ausente,
      // provedor fora do ar) — quem está testando precisa ver o motivo real,
      // diferente do fluxo de produção (receiveInbound), que degrada calado.
      const message = error instanceof Error ? error.message : 'Falha ao chamar a IA.';
      throw new BadGatewayException(message);
    }
  }
}
