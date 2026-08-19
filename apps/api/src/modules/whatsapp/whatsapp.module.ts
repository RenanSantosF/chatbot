import { Module } from '@nestjs/common';
import { CanalService } from './canal/canal.service';
import { EvolutionCanal } from './canal/evolution/evolution.canal';
import { EvolutionController } from './canal/evolution/evolution.controller';
import { EvolutionService } from './canal/evolution/evolution.service';
import { EmbeddedSignupController } from './embedded-signup.controller';
import { EmbeddedSignupService } from './embedded-signup.service';
import { WhatsappMediaController } from './whatsapp-media.controller';
import { WhatsappMediaService } from './whatsapp-media.service';
import { EstadoDoCanalService } from './canal/estado-do-canal.service';
import { WhatsappSenderService } from './whatsapp-sender.service';
import { WhatsappSettingsController } from './whatsapp-settings.controller';
import { WhatsappSettingsService } from './whatsapp-settings.service';

@Module({
  controllers: [
    WhatsappSettingsController,
    WhatsappMediaController,
    EmbeddedSignupController,
    EvolutionController,
  ],
  providers: [
    WhatsappSettingsService,
    WhatsappSenderService,
    WhatsappMediaService,
    EstadoDoCanalService,
    EmbeddedSignupService,
    CanalService,
    EvolutionCanal,
    EvolutionService,
  ],
  // O `WhatsappSenderService` continua exportado porque a mídia ainda passa
  // por ele. Quem só manda texto, reação ou modelo deve pedir o
  // `CanalService` — é ele que respeita a escolha de provedor da empresa.
  exports: [
    CanalService,
    WhatsappSenderService,
    WhatsappMediaService,
    EstadoDoCanalService,
    // Apagar a conta precisa derrubar a sessão do WhatsApp antes, senão
    // ela fica órfã no servidor de mensagens (ver AccountService).
    EvolutionService,
  ],
})
export class WhatsappModule {}
