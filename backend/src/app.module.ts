import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE, APP_INTERCEPTOR, APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.service';
import { RedisModule } from './redis/redis.module';
import { TenantModule } from './shared/tenant';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { AgentsModule } from './modules/agents/agents.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { ToolsModule } from './modules/tools/tools.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AiModule } from './modules/ai/ai.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { AuditModule } from './modules/audit/audit.module';
import { BillingModule } from './modules/billing/billing.module';
import { MailModule } from './modules/mail/mail.module';
import { StorageModule } from './modules/storage/storage.service';
import { MemoryModule } from './modules/memory/memory.module';
import { QuotaModule } from './modules/quota/quota.module';
import { HealthController } from './health.controller';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';
import { HttpErrorFilter } from './common/filters/http-error.filter';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { AppLoggerModule } from './logger.module';

@Module({
  imports: [
    AppLoggerModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        { ttl: parseInt(process.env.THROTTLE_TTL_MS ?? '60000', 10), limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10) },
      ],
    }),
    PrismaModule,
    RedisModule,
    MailModule,
    StorageModule,
    MemoryModule,
    QuotaModule,
    TenantModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    InvitationsModule,
    AgentsModule,
    ConversationsModule,
    KnowledgeModule,
    ToolsModule,
    IntegrationsModule,
    TasksModule,
    AnalyticsModule,
    AiModule,
    WorkflowsModule,
    AuditModule,
    BillingModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule {}
