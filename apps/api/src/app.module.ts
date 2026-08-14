import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { PermissionsGuard } from './common/auth/permissions.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { CryptoModule } from './common/crypto/crypto.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { CollectionModule } from './modules/collection/collection.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { CustomersModule } from './modules/customers/customers.module';
import { CopilotModule } from './modules/copilot/copilot.module';
import { RetentionModule } from './modules/retention/retention.module';
import { InboxSettingsModule } from './modules/inbox-settings/inbox-settings.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { QueuesModule } from './modules/queues/queues.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RoutingModule } from './modules/routing/routing.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { WhatsappWebhookModule } from './modules/whatsapp/whatsapp-webhook.module';

import { StorageModule } from './modules/storage/storage.module';

@Module({
  imports: [
    /**
     * Limite de requisições por IP.
     *
     * O alvo é o login: sem teto, uma senha de oito caracteres cai em
     * tentativa e erro automatizada, e a única defesa que existia era a
     * força da senha que o cliente escolheu. Os dois baldes valem juntos —
     * o curto corta a rajada, o longo corta a tentativa paciente.
     *
     * O padrão é folgado de propósito: o painel dispara várias chamadas por
     * tela (conversas, contadores, permissões) e apertar aqui quebraria o
     * uso normal antes de atrapalhar qualquer atacante. Os endpoints que
     * merecem rigor recebem @Throttle próprio (ver AuthController).
     */
    ThrottlerModule.forRoot([
      { name: 'curto', ttl: seconds(10), limit: 60 },
      { name: 'longo', ttl: seconds(60), limit: 300 },
    ]),
    StorageModule,
    CryptoModule,
    PrismaModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    CustomersModule,
    ConversationsModule,
    CollectionModule,
    InboxSettingsModule,
    CopilotModule,
    RetentionModule,
    RealtimeModule,
    AiModule,
    KnowledgeModule,
    MetricsModule,
    PermissionsModule,
    TasksModule,
    QueuesModule,
    RoutingModule,
    WhatsappModule,
    WhatsappWebhookModule,
  ],
  providers: [
    // Antes de tudo: barrar excesso não deve custar consulta ao banco nem
    // verificação de token.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
