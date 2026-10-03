import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * Global porque quem manda e-mail é gente espalhada — a senha esquecida,
 * o aviso de WhatsApp caído, o resumo da semana — e nenhum deles deveria
 * importar o módulo do outro pra isso.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
