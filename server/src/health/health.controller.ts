import {
  Controller,
  Get,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { RequestContextService } from '../common/context/request-context';
import { Public } from '../common/decorators/auth.decorators';

/**
 * `/health` and `/readiness` — deliberately unversioned and unauthenticated.
 *
 * A container orchestrator has no credentials and does not negotiate API
 * versions, so these are excluded from the `/api` prefix in `main.ts` and
 * declared `VERSION_NEUTRAL` here. Both halves are needed: without the second,
 * the routes land at `/v1/health` and every probe 404s — which presents as a
 * failing deployment rather than as a misconfigured probe.
 *
 * The two endpoints answer different questions on purpose:
 *
 *   /health    — is this process alive? Cheap, no dependencies. A failing
 *                dependency must NOT fail this, or a brief database blip makes
 *                the orchestrator restart every replica, turning a recoverable
 *                outage into a total one.
 *
 *   /readiness — can this process serve traffic? Checks the database. A false
 *                answer takes the replica out of the load balancer without
 *                killing it, which is the right response to a dependency being
 *                down.
 *
 * Neither reveals anything: no versions, no hostnames, no connection strings.
 */
@ApiTags('health')
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness — is the process running?' })
  health() {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('readiness')
  @ApiOperation({ summary: 'Readiness — can it serve traffic?' })
  async readiness() {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    // `SELECT 1` on an unscoped context: the health probe has no tenant, and
    // the tenant guard would otherwise refuse. `$queryRaw` bypasses the guard
    // anyway, but the wrapper keeps the intent explicit and greppable.
    checks.database = await this.requestContext.runAsSystem(async () => {
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.name : 'unreachable',
        };
      }
    }, 'health');

    // A real PING, not `isInline`. Asking whether Redis was CONFIGURED reports
    // "redis" cheerfully while Redis is down — a configured-but-dead client is
    // still a non-null object — and an orchestrator would keep routing traffic
    // to an instance whose jobs are going nowhere.
    checks.queue = await this.queue.ping();

    // Only the database gates readiness. Inline mode is a legitimate
    // configuration, and a Redis outage degrades report generation rather than
    // stopping the API from serving cases — so a dead queue is REPORTED
    // truthfully above while the instance stays in rotation. Deriving `ready`
    // from every check would couple those two decisions and make an honest
    // queue check impossible to add without taking the API offline with it.
    const ready = checks.database.ok;

    if (!ready) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        checks,
        timestamp: new Date().toISOString(),
      });
    }

    return { status: 'ready', checks, timestamp: new Date().toISOString() };
  }
}
