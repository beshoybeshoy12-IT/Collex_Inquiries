import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { RealtimeModule } from './realtime/realtime.module';
import { PushModule } from './push/push.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RolesModule } from './roles/roles.module';

import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { InvestigatorsModule } from './investigators/investigators.module';
import { CustomersModule } from './customers/customers.module';
import { InvestigationsModule } from './investigations/investigations.module';
import { ProductsModule } from './products/products.module';
import { InvestigationTypesModule } from './investigation-types/investigation-types.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { ImportsModule } from './imports/imports.module';
import { FormsModule } from './forms/forms.module';
import { QcModule } from './qc/qc.module';
import { MediaModule } from './media/media.module';
import { GpsModule } from './gps/gps.module';
import { ReportsModule } from './reports/reports.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { GeographyModule } from './geography/geography.module';
import { SlaModule } from './sla/sla.module';
import { HealthModule } from './health/health.module';

import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { BilingualThrottlerGuard } from './common/guards/bilingual-throttler.guard';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { CronLockService } from './common/services/cron-lock.service';
import { ScheduledTasksService } from './common/services/scheduled-tasks.service';
import { env, isProduction } from './common/config/env';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The API application.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  GUARD ORDER IS LOad-BEARING. `JwtAuthGuard` is registered first so it runs
 *  first, putting the principal on the request; `PermissionsGuard` then reads
 *  it. Reversed, the permission guard would see no user and either reject
 *  everything or — worse, if somebody "fixed" it by allowing an absent user —
 *  allow everything.
 *
 *  Both are global, which makes the default CLOSED: a new controller written by
 *  someone who did not think about authorization requires a token, and requires
 *  a web-user principal. Opting out is `@Public()`, which is greppable.
 */
@Module({
  imports: [
    // ── Infrastructure ───────────────────────────────────────────────────
    PrismaModule,
    AuditModule,
    AuthModule,
    QueueModule,
    StorageModule,
    RealtimeModule,
    // Before NotificationsModule, which delivers through it.
    PushModule,
    NotificationsModule,
    RolesModule,
    HealthModule,

    CacheModule.register({
      isGlobal: true,
      // Default TTL for anything cached without one. The auth cache sets its
      // own 30 seconds explicitly — see AuthCacheService.
      ttl: 60_000,
    }),

    LoggerModule.forRoot({
      pinoHttp: {
        level: env('LOG_LEVEL', isProduction() ? 'info' : 'debug'),
        transport: isProduction()
          ? undefined
          : {
              target: 'pino-pretty',
              options: { colorize: true, ignore: 'req,res,hostname,pid' },
            },
        genReqId: (req) => req.headers['x-request-id'] ?? randomUUID(),
        // Bodies are never logged. This database holds national ids, home
        // addresses and bank references, and a log aggregator is a second
        // place they would then live.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body',
            'res.body',
          ],
          remove: true,
        },
      },
    }),

    ScheduleModule.forRoot(),

    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 300,
      },
    ]),

    // ── Domain ───────────────────────────────────────────────────────────
    TenantsModule,
    UsersModule,
    InvestigatorsModule,
    CustomersModule,
    InvestigationsModule,
    ProductsModule,
    InvestigationTypesModule,
    AssignmentsModule,
    ImportsModule,
    FormsModule,
    QcModule,
    MediaModule,
    GpsModule,
    ReportsModule,
    AnalyticsModule,
    GeographyModule,
    SlaModule,
  ],
  providers: [
    // Not the stock ThrottlerGuard: its message is the literal string
    // "ThrottlerException: Too Many Requests", which is a class name, is
    // English-only in a bilingual app, and never says how long to wait.
    { provide: APP_GUARD, useClass: BilingualThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Registered here rather than in main.ts because it needs PrismaService
    // and the request context injected. It is a no-op unless the caller sends
    // an Idempotency-Key header, so it costs an object per request and nothing
    // else for the web client.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    CronLockService,
    ScheduledTasksService,
  ],
  exports: [CronLockService],
})
export class AppModule implements NestModule {
  /**
   * The request context has to be opened in middleware, not an interceptor.
   *
   * An interceptor's `next.handle()` only builds an Observable; the handler
   * runs on subscription, by which time an AsyncLocalStorage scope opened in
   * the interceptor has closed. Middleware calls `next()` inside the scope, so
   * guards and handler alike inherit it — and the tenant guard, which reads
   * that context on every query, refuses to run without it.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
