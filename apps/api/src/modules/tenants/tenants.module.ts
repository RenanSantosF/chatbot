import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { TenantsService } from './tenants.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [WhatsappModule],
  controllers: [OnboardingController],
  providers: [TenantsService, OnboardingService],
  exports: [TenantsService],
})
export class TenantsModule {}
