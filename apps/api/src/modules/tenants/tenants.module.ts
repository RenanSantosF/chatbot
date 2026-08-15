import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [OnboardingController],
  providers: [TenantsService, OnboardingService],
  exports: [TenantsService],
})
export class TenantsModule {}
