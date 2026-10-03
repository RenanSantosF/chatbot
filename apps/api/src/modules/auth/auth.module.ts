import { Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { BillingModule } from '../billing/billing.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RedefinicaoDeSenhaService } from './redefinicao-de-senha.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    WhatsappModule,
    RealtimeModule,
    BillingModule,

    PassportModule,
    TenantsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN ??
          '7d') as JwtSignOptions['expiresIn'],
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    RedefinicaoDeSenhaService,
  ],
})
export class AuthModule {}
