import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { TenantsService } from './tenants.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [WhatsappModule],
  controllers: [OnboardingController, AccountController],
  providers: [TenantsService, OnboardingService, AccountService],
  exports: [TenantsService],
})
export class TenantsModule {}
