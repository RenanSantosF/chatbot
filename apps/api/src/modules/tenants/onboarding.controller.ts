import { Body, Controller, Get, Post } from '@nestjs/common';
import { SalvarPerfilDto } from './dto/onboarding.dto';
import { OnboardingService } from './onboarding.service';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** Estado da primeira configuração. Todo mundo que entra no painel lê. */
  @Get()
  progresso() {
    return this.onboarding.progresso();
  }

  @Post('perfil')
  salvarPerfil(@Body() dto: SalvarPerfilDto) {
    return this.onboarding.salvarPerfil(dto);
  }

  @Post('dispensar')
  dispensar() {
    return this.onboarding.dispensar();
  }
}
