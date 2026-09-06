import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
} from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';
import { PrincipalType } from '@prisma/client';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  IdempotencyInFlightError,
  IdempotencyInterceptor,
} from './idempotency.interceptor';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Idempotency-Key
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The scenario this exists for: an investigator submits a case from a
 *  stairwell, the server commits, the reply is lost, the phone retries. One
 *  submission must reach the database.
 *
 *  These tests are about the RULES rather than the plumbing — which requests
 *  are protected, which are ignored, what happens when the store is
 *  unavailable, and what happens when the operation fails. Each is a decision
 *  that could reasonably have gone the other way, so each says why.
 */

type PrismaStub = {
  idempotencyKey: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
};

const UNIQUE_VIOLATION = Object.assign(new Error('unique constraint'), {
  code: 'P2002',
});

function makePrisma(): PrismaStub {
  return {
    idempotencyKey: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
}

function makeContext(overrides: {
  method?: string;
  headers?: Record<string, string>;
  path?: string;
  statusCode?: number;
}) {
  const response = {
    statusCode: overrides.statusCode ?? 201,
    status: jest.fn(function (this: unknown, code: number) {
      (response as { statusCode: number }).statusCode = code;
      return response;
    }),
    setHeader: jest.fn(),
  };

  const request = {
    method: overrides.method ?? 'POST',
    headers: overrides.headers ?? {},
    path: overrides.path ?? '/api/v1/investigations/abc/comments',
    route: { path: '/investigations/:id/comments' },
  };

  const context = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  return { context, request, response };
}

const handlerReturning = (value: unknown): CallHandler => ({
  handle: () => of(value),
});

const handlerThrowing = (error: Error): CallHandler => ({
  handle: () => throwError(() => error),
});

const WEB_CONTEXT = {
  tenantId: 'tenant-1',
  principalType: PrincipalType.WEB_USER,
  principalId: 'user-1',
  principalName: 'Mona',
  crossTenant: false,
};

function makeInterceptor(prisma: PrismaStub, ctx: unknown = WEB_CONTEXT) {
  const requestContext = { get: () => ctx } as never;
  return new IdempotencyInterceptor(prisma as never, requestContext);
}

describe('IdempotencyInterceptor', () => {
  describe('when it does nothing at all', () => {
    it('passes through a request with no Idempotency-Key', async () => {
      const prisma = makePrisma();
      const { context } = makeContext({ headers: {} });

      const result = await lastValueFrom(
        makeInterceptor(prisma).intercept(context, handlerReturning({ ok: 1 })),
      );

      expect(result).toEqual({ ok: 1 });
      expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
    });

    it('ignores the header on a GET', async () => {
      // A GET is idempotent already. Honouring the header there would cache a
      // read under a client-chosen key, which is a cache-poisoning primitive.
      const prisma = makePrisma();
      const { context } = makeContext({
        method: 'GET',
        headers: { 'idempotency-key': 'k1' },
      });

      await lastValueFrom(
        makeInterceptor(prisma).intercept(context, handlerReturning({ ok: 1 })),
      );

      expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
    });

    it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
      'does act on a %s',
      async (method) => {
        const prisma = makePrisma();
        const { context } = makeContext({
          method,
          headers: { 'idempotency-key': 'k1' },
        });

        await lastValueFrom(
          makeInterceptor(prisma).intercept(
            context,
            handlerReturning({ ok: 1 }),
          ),
        );

        expect(prisma.idempotencyKey.create).toHaveBeenCalled();
      },
    );

    it('ignores the header when there is no authenticated principal', async () => {
      // A key shared between callers is worse than no key: one caller's retry
      // would replay another caller's response.
      const prisma = makePrisma();
      const { context } = makeContext({ headers: { 'idempotency-key': 'k1' } });

      await lastValueFrom(
        makeInterceptor(prisma, null).intercept(
          context,
          handlerReturning({ ok: 1 }),
        ),
      );

      expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
    });

    it('rejects an absurdly long key instead of storing it', () => {
      const prisma = makePrisma();
      const { context } = makeContext({
        headers: { 'idempotency-key': 'x'.repeat(500) },
      });

      expect(() =>
        makeInterceptor(prisma).intercept(context, handlerReturning({})),
      ).toThrow(BadRequestException);
    });
  });

  describe('claiming', () => {
    it('scopes the key by tenant, principal and endpoint', async () => {
      // The same key from two investigators, or on two endpoints, is two
      // different operations. Without this, one user's retry could replay
      // another's response.
      const prisma = makePrisma();
      const { context } = makeContext({
        headers: { 'idempotency-key': 'client-key' },
      });

      await lastValueFrom(
        makeInterceptor(prisma).intercept(context, handlerReturning({ ok: 1 })),
      );

      const stored = prisma.idempotencyKey.create.mock.calls[0][0].data.key;
      expect(stored).toContain('tenant-1');
      expect(stored).toContain('user-1');
      expect(stored).toContain('POST /investigations/:id/comments');
      expect(stored).toContain('client-key');
    });

    it('claims before running the handler, not after', async () => {
      // Recording afterwards protects a sequential retry and does nothing for
      // two requests in flight at once — which is exactly what a double-tap on
      // a slow connection produces.
      const prisma = makePrisma();
      const order: string[] = [];
      prisma.idempotencyKey.create.mockImplementation(() => {
        order.push('claim');
        return Promise.resolve({});
      });
      const { context } = makeContext({
        headers: { 'idempotency-key': 'k1' },
      });
      const handler: CallHandler = {
        handle: () => {
          order.push('handler');
          return of({ ok: 1 });
        },
      };

      await lastValueFrom(makeInterceptor(prisma).intercept(context, handler));

      expect(order).toEqual(['claim', 'handler']);
    });
  });

  describe('replaying', () => {
    it('returns the stored response without running the handler again', async () => {
      const prisma = makePrisma();
      prisma.idempotencyKey.create.mockRejectedValue(UNIQUE_VIOLATION);
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        statusCode: 201,
        response: { success: true, data: { id: 'comment-1' } },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const { context, response } = makeContext({
        headers: { 'idempotency-key': 'k1' },
      });
      const handler = jest.fn(() => of({ id: 'comment-2' }));

      const result = await lastValueFrom(
        makeInterceptor(prisma).intercept(context, { handle: handler }),
      );

      expect(handler).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: { id: 'comment-1' } });
      expect(response.status).toHaveBeenCalledWith(201);
    });

    it('marks a replay so the client can tell', async () => {
      const prisma = makePrisma();
      prisma.idempotencyKey.create.mockRejectedValue(UNIQUE_VIOLATION);
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        statusCode: 200,
        response: { ok: true },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const { context, response } = makeContext({
        headers: { 'idempotency-key': 'k1' },
      });

      await lastValueFrom(
        makeInterceptor(prisma).intercept(context, handlerReturning({})),
      );

      expect(response.setHeader).toHaveBeenCalledWith(
        'Idempotent-Replay',
        'true',
      );
    });

    it('refuses a second request while the first is still running', async () => {
      // The loser of the race must not be allowed through to do the work
      // twice. It is told to wait.
      const prisma = makePrisma();
      prisma.idempotencyKey.create.mockRejectedValue(UNIQUE_VIOLATION);
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        statusCode: 0, // the in-flight sentinel
        response: {},
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const { context } = makeContext({ headers: { 'idempotency-key': 'k1' } });

      await expect(
        lastValueFrom(
          makeInterceptor(prisma).intercept(context, handlerReturning({})),
        ),
      ).rejects.toBeInstanceOf(IdempotencyInFlightError);
    });

    it('takes over a claim left behind by a crashed process', async () => {
      // Nobody is going to settle a claim whose process died. Holding the key
      // forever would lock the client out of that operation permanently.
      const prisma = makePrisma();
      prisma.idempotencyKey.create.mockRejectedValue(UNIQUE_VIOLATION);
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        statusCode: 0,
        response: {},
        createdAt: new Date(Date.now() - 30 * 60_000), // half an hour ago
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const { context } = makeContext({ headers: { 'idempotency-key': 'k1' } });
      const handler = jest.fn(() => of({ ok: 1 }));

      const result = await lastValueFrom(
        makeInterceptor(prisma).intercept(context, { handle: handler }),
      );

      expect(handler).toHaveBeenCalled();
      expect(result).toEqual({ ok: 1 });
    });

    it('lets an expired key be reused rather than stranding the client', async () => {
      const prisma = makePrisma();
      prisma.idempotencyKey.create.mockRejectedValue(UNIQUE_VIOLATION);
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        statusCode: 201,
        response: { old: true },
        createdAt: new Date(Date.now() - 48 * 3600_000),
        expiresAt: new Date(Date.now() - 3600_000), // expired an hour ago
      });

      const { context } = makeContext({ headers: { 'idempotency-key': 'k1' } });
      const handler = jest.fn(() => of({ fresh: true }));

      const result = await lastValueFrom(
        makeInterceptor(prisma).intercept(context, { handle: handler }),
      );

      expect(handler).toHaveBeenCalled();
      expect(result).toEqual({ fresh: true });
    });
  });

  describe('what is not remembered', () => {
    it('releases the claim when the handler throws', async () => {
      // A failure is not a completed operation. Leaving the claim standing
      // would lock a legitimate retry out for the whole stale window.
      const prisma = makePrisma();
      const { context } = makeContext({ headers: { 'idempotency-key': 'k1' } });

      await expect(
        lastValueFrom(
          makeInterceptor(prisma).intercept(
            context,
            handlerThrowing(new Error('boom')),
          ),
        ),
      ).rejects.toThrow('boom');

      expect(prisma.idempotencyKey.delete).toHaveBeenCalled();
      expect(prisma.idempotencyKey.update).not.toHaveBeenCalled();
    });

    it('does not record a non-2xx response', async () => {
      // Replaying a 500 for a day turns a transient blip into a permanent
      // failure for that key.
      const prisma = makePrisma();
      const { context } = makeContext({
        headers: { 'idempotency-key': 'k1' },
        statusCode: 422,
      });

      await lastValueFrom(
        makeInterceptor(prisma).intercept(
          context,
          handlerReturning({ bad: 1 }),
        ),
      );

      expect(prisma.idempotencyKey.update).not.toHaveBeenCalled();
      expect(prisma.idempotencyKey.delete).toHaveBeenCalled();
    });

    it('does not try to store a file stream', async () => {
      const prisma = makePrisma();
      const { context } = makeContext({ headers: { 'idempotency-key': 'k1' } });
      const stream = new StreamableFile(Buffer.from('pdf bytes'));

      await lastValueFrom(
        makeInterceptor(prisma).intercept(context, handlerReturning(stream)),
      );

      expect(prisma.idempotencyKey.update).not.toHaveBeenCalled();
      expect(prisma.idempotencyKey.delete).toHaveBeenCalled();
    });

    it('records a 2xx response so the retry can replay it', async () => {
      const prisma = makePrisma();
      const { context } = makeContext({
        headers: { 'idempotency-key': 'k1' },
        statusCode: 201,
      });

      await lastValueFrom(
        makeInterceptor(prisma).intercept(
          context,
          handlerReturning({ id: 'comment-1' }),
        ),
      );

      expect(prisma.idempotencyKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { statusCode: 201, response: { id: 'comment-1' } },
        }),
      );
    });
  });

  describe('when the store itself is unavailable', () => {
    it('lets the request through rather than refusing the work', async () => {
      // Idempotency is a safety net, not a dependency. The worst case here is
      // the duplicate this was meant to prevent, which is strictly better than
      // an investigator being unable to submit at all.
      const prisma = makePrisma();
      prisma.idempotencyKey.create.mockRejectedValue(new Error('db down'));
      prisma.idempotencyKey.findUnique.mockRejectedValue(new Error('db down'));

      const { context } = makeContext({ headers: { 'idempotency-key': 'k1' } });

      const result = await lastValueFrom(
        makeInterceptor(prisma).intercept(context, handlerReturning({ ok: 1 })),
      );

      expect(result).toEqual({ ok: 1 });
    });

    it('does not fail the request when settling the record fails', async () => {
      const prisma = makePrisma();
      prisma.idempotencyKey.update.mockRejectedValue(new Error('db down'));

      const { context } = makeContext({ headers: { 'idempotency-key': 'k1' } });

      const result = await lastValueFrom(
        makeInterceptor(prisma).intercept(context, handlerReturning({ ok: 1 })),
      );

      expect(result).toEqual({ ok: 1 });
    });
  });
});
