import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { TenantsService } from './tenants.service';
import { AiModule } from '../ai/ai.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  // O AiModule entra porque o progresso do onboarding pergunta ao motor se
  // a IA tem condição de atender, em vez de reconstruir essa conta olhando
  // a tabela de configuração (ver OnboardingService.progresso).
  imports: [WhatsappModule, AiModule],
  controllers: [OnboardingController, AccountController],
  providers: [TenantsService, OnboardingService, AccountService],
  exports: [TenantsService],
})
export class TenantsModule {}
