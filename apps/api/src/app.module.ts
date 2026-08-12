import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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

@Module({
  imports: [
    CryptoModule,
    PrismaModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    CustomersModule,
    ConversationsModule,
    CollectionModule,
    InboxSettingsModule,
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
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
