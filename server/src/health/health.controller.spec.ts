import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Readiness
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  These tests exist because of a real bug, found by running the API with
 *  Redis switched off and reading what the probe said.
 *
 *  It reported `{"queue":{"ok":true,"detail":"redis"}}`.
 *
 *  The check was asking `queue.isInline` — whether Redis had been CONFIGURED —
 *  and a configured-but-unreachable client is still a non-null object, so the
 *  answer was always "healthy". An orchestrator would have kept routing to an
 *  instance whose jobs were going nowhere, and nothing would have said so.
 *
 *  Two rules now hold at once, and they pull in opposite directions, which is
 *  why both are pinned:
 *
 *    1. The queue check tells the TRUTH about whether Redis answers.
 *    2. A dead queue does NOT take the instance out of rotation — reports
 *       degrade, cases keep being served. Only the database gates readiness.
 *
 *  Deriving `ready` from "every check passes" satisfies (2) only by making (1)
 *  impossible, which is exactly how the bug survived.
 */
describe('HealthController — readiness', () => {
  const makeController = (options: {
    databaseOk?: boolean;
    queue?: { ok: boolean; detail: string };
  }) => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockImplementation(() =>
          options.databaseOk === false
            ? Promise.reject(new Error('connection refused'))
            : Promise.resolve([{ '?column?': 1 }]),
        ),
    };

    const queue = {
      ping: jest
        .fn()
        .mockResolvedValue(options.queue ?? { ok: true, detail: 'redis' }),
      isInline: false,
    };

    // The probe has no tenant, so it runs unscoped; the wrapper just invokes.
    const requestContext = {
      runAsSystem: jest.fn(<T>(fn: () => T | Promise<T>) =>
        Promise.resolve(fn()),
      ),
    };

    const controller = new HealthController(
      prisma as never,
      queue as never,
      requestContext as never,
    );

    return { controller, prisma, queue, requestContext };
  };

  it('reports ready when the database and the queue are both up', async () => {
    const { controller } = makeController({});
    const result = await controller.readiness();

    expect(result.status).toBe('ready');
    expect(result.checks.database.ok).toBe(true);
    expect(result.checks.queue.ok).toBe(true);
  });

  it('asks the queue whether it ANSWERS, not whether it is configured', async () => {
    // The whole bug in one assertion. `isInline` must not be what decides
    // this — it is a question about configuration, not liveness.
    const { controller, queue } = makeController({});
    await controller.readiness();

    expect(queue.ping).toHaveBeenCalled();
  });

  it('reports a dead queue honestly instead of claiming "redis"', async () => {
    const { controller } = makeController({
      queue: { ok: false, detail: 'redis unreachable: timeout' },
    });

    const result = await controller.readiness();

    expect(result.checks.queue.ok).toBe(false);
    expect(result.checks.queue.detail).toContain('unreachable');
  });

  it('stays READY with a dead queue — reports degrade, cases do not', async () => {
    // The counterpart to the test above, and the reason `ready` is not simply
    // "every check passed". Taking the API out of rotation over a Redis outage
    // would turn a degraded reporting feature into a total outage.
    const { controller } = makeController({
      queue: { ok: false, detail: 'redis unreachable: timeout' },
    });

    const result = await controller.readiness();

    expect(result.status).toBe('ready');
  });

  it('reports inline mode as healthy, because it is a real configuration', async () => {
    const { controller } = makeController({
      queue: { ok: true, detail: 'inline (no Redis configured)' },
    });

    const result = await controller.readiness();

    expect(result.status).toBe('ready');
    expect(result.checks.queue.ok).toBe(true);
    expect(result.checks.queue.detail).toContain('inline');
  });

  it('refuses readiness when the database is unreachable', async () => {
    // The database is the one dependency without which nothing works, so it is
    // the one that gates.
    const { controller } = makeController({ databaseOk: false });

    await expect(controller.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('includes the failing checks in the 503 body', async () => {
    // A probe that fails without saying which dependency died makes an
    // operator SSH in to find out.
    const { controller } = makeController({ databaseOk: false });

    await expect(controller.readiness()).rejects.toMatchObject({
      response: expect.objectContaining({
        status: 'unavailable',
        checks: expect.objectContaining({
          database: expect.objectContaining({ ok: false }),
        }),
      }),
    });
  });

  it('runs the database probe unscoped', async () => {
    // The probe has no tenant. Without the unscoped wrapper the tenant guard
    // would refuse the query and readiness would fail for the wrong reason.
    const { controller, requestContext } = makeController({});
    await controller.readiness();

    expect(requestContext.runAsSystem).toHaveBeenCalled();
  });
});
