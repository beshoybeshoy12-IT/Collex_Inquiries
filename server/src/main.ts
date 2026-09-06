import 'dotenv/config';
import {
  Logger as NestLogger,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import * as express from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { env, envInt, envList, isProduction } from './common/config/env';

/**
 * Node kills the process on an unhandled rejection and leaves the runtime in an
 * undefined state after an uncaught exception. Neither should drop every
 * in-flight request without a trace of why — log first, then let the process
 * exit so the restart policy takes over.
 *
 * Installed before bootstrap so failures during startup are caught too.
 */
function installProcessHandlers(): void {
  const log = new NestLogger('Process');

  process.on('unhandledRejection', (reason) => {
    log.error(
      'Unhandled promise rejection',
      reason instanceof Error ? reason.stack : String(reason),
    );
  });

  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception — shutting down', error.stack);
    // The runtime is no longer trustworthy; exit and let the container restart
    // cleanly rather than serving from a broken state.
    process.exit(1);
  });
}

/**
 * State this process holds that no other instance shares.
 *
 * Said plainly at boot rather than discovered in production. Everything here is
 * a real limitation of running more than one replica, and every one of them has
 * a known fix — but a fix nobody applies because nobody knew.
 */
function warnAboutSingleInstanceState(): void {
  const log = new NestLogger('Scaling');
  const perProcess: string[] = [
    'the 30-second principal cache (CacheModule has no shared store), so a ' +
      'revoked session stays valid on replicas that never saw the change',
    'rate-limit counters (ThrottlerModule has no shared storage), so the ' +
      'effective limit is 300/min x replicas',
    'socket.io has no Redis adapter, so an event emitted on one replica never ' +
      'reaches clients connected to another',
  ];

  if (!env('REDIS_URL')) {
    perProcess.push(
      'the job queue is running INLINE — reports and exports execute inside ' +
        'the request that triggers them',
    );
  }

  log.warn(
    'Running as a SINGLE INSTANCE. Per-process state that does not survive ' +
      'scaling out: ' +
      perProcess.map((s, i) => `(${i + 1}) ${s}`).join('; ') +
      '. Scheduled jobs are already guarded by a database lease.',
  );
}

async function bootstrap(): Promise<void> {
  installProcessHandlers();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  /**
   * `/api/v1/...` — versioned from the first release rather than added later.
   *
   * The future mobile application will be pinned to a version it was built
   * against, and adding a version prefix afterwards means every client breaks
   * at once. `/health` and `/readiness` are excluded because an orchestrator
   * does not negotiate versions.
   */
  app.setGlobalPrefix('api', { exclude: ['health', 'readiness'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Number of proxy hops to trust for client IPs. Without it, behind nginx
  // every request appears to come from the proxy and rate limiting becomes a
  // single global bucket.
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', envInt('TRUST_PROXY', 0));

  app.use(
    helmet({
      // The API serves JSON, not HTML, so CSP here would only constrain the
      // Swagger UI. It is disabled rather than misconfigured; the SPA gets its
      // own CSP from nginx, which is where it belongs.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.enableCors({
    origin: envList('CORS_ORIGINS', [
      'http://localhost:5174',
      'http://127.0.0.1:5174',
    ]),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  // 10 MB covers a JSON import preview and a batch of form answers. Actual
  // files go to object storage through presigned URLs and never pass here.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      // `whitelist` strips unknown properties; `forbidNonWhitelisted` rejects
      // them instead. Together they are what makes "there is no tenantId field
      // in any DTO" an enforced rule rather than a convention.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  if (!isProduction()) {
    const config = new DocumentBuilder()
      .setTitle('Collex Inquiries API')
      .setDescription(
        'Field Investigation / Field Verification Management System. ' +
          'The same API serves the web platform and the future mobile ' +
          'application for field investigators.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication, sessions and token rotation')
      .addTag('tenants', 'Company profile and provisioning')
      .addTag('users', 'Web platform users')
      .addTag('roles', 'Roles and permission grants')
      .addTag('investigators', 'Field investigators')
      .addTag('customers', 'Customers and Customer 360')
      .addTag('investigations', 'Cases, status transitions and timeline')
      .addTag('assignments', 'Assignment, bulk assignment and reassignment')
      .addTag('imports', 'Excel import, mapping and duplicate detection')
      .addTag('forms', 'Dynamic forms, versions and submissions')
      .addTag('qc', 'Quality control review and rework')
      .addTag('media', 'Evidence: photos, documents, signatures')
      .addTag('gps', 'GPS evidence')
      .addTag('reports', 'Report generation and templates')
      .addTag('dashboard', 'Dashboard and analytics')
      .addTag('sla', 'SLA policies and escalation rules')
      .addTag('audit', 'Audit trail')
      .build();

    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, config),
    );
  }

  warnAboutSingleInstanceState();

  const port = envInt('PORT', 5100);
  await app.listen(port, '0.0.0.0');

  new NestLogger('Bootstrap').log(
    `Collex Inquiries API listening on :${port}` +
      (isProduction() ? '' : ` — docs at http://localhost:${port}/api/docs`),
  );
}

void bootstrap();
