import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { PrincipalType } from '@prisma/client';

/**
 * Who is making the current request, carried out-of-band.
 *
 * Threading this through every function signature is what the codebase does
 * for the things that *must* be explicit — a service method takes `tenantId`
 * as an argument, always. This store exists for the things that must be
 * implicit: the last-line-of-defence tenant filter in `tenant-guard`, and the
 * actor fields on an audit row. Both need the caller's identity in places that
 * have no business taking it as a parameter, and both are wrong if it is
 * missing rather than merely inconvenient.
 *
 * A background job runs with `runAsSystem()`, which sets a context that the
 * tenant guard recognises as "no tenant filter" — jobs legitimately sweep
 * across tenants. That is the only way to get an unscoped query, and it is not
 * reachable from an HTTP handler.
 */
export interface RequestContext {
  /** Null only for platform operators and system jobs. */
  tenantId: string | null;
  principalType: PrincipalType | null;
  principalId: string | null;
  principalName: string | null;
  /** Bypasses tenant scoping. True for super admins and system jobs. */
  crossTenant: boolean;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

@Injectable()
export class RequestContextService {
  /** The current context, or null outside any run() — e.g. at boot. */
  get(): RequestContext | null {
    return storage.getStore() ?? null;
  }

  get tenantId(): string | null {
    return storage.getStore()?.tenantId ?? null;
  }

  get principalId(): string | null {
    return storage.getStore()?.principalId ?? null;
  }

  get isCrossTenant(): boolean {
    return storage.getStore()?.crossTenant ?? false;
  }

  /** Run `fn` with the given context bound to it and everything it awaits. */
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  }

  /**
   * Fill in the principal on the context the middleware already opened.
   *
   * The store has to be established in middleware, because that is the only
   * hook that wraps the route handler in the same async scope — an interceptor
   * returns an Observable whose handler runs on subscription, outside whatever
   * scope the interceptor set up. But middleware runs before the auth guard, so
   * at that point there is no principal to record.
   *
   * The context object is therefore created empty and mutated here once the
   * JWT strategy has resolved who is calling. Mutation is safe precisely
   * because AsyncLocalStorage holds the reference, not a copy.
   */
  setPrincipal(principal: {
    tenantId: string | null;
    principalType: PrincipalType;
    principalId: string;
    principalName: string;
    crossTenant: boolean;
  }): void {
    const store = storage.getStore();
    if (!store) return;

    store.tenantId = principal.tenantId;
    store.principalType = principal.principalType;
    store.principalId = principal.principalId;
    store.principalName = principal.principalName;
    store.crossTenant = principal.crossTenant;
  }

  /**
   * Run `fn` as the platform itself: no tenant filter, no principal.
   *
   * Used by cron sweeps and queue workers, which legitimately read across every
   * tenant. Deliberately a named, greppable escape hatch rather than "leave the
   * context empty and hope" — an unset context is treated as an error by the
   * guard precisely so that forgetting is loud.
   *
   * ASYNC, AND THE `await` INSIDE IS LOAD-BEARING. Prisma promises are lazy:
   * `prisma.user.findMany()` builds a `PrismaPromise` and does not execute
   * until something calls `.then()` on it. A synchronous wrapper would return
   * that unexecuted promise, the AsyncLocalStorage scope would close, and the
   * query would then run with no context at all — which the tenant guard
   * correctly refuses. Awaiting here means `.then()` is invoked while the scope
   * is still open, so every call site gets the context whether or not it
   * remembered to await inside its own callback.
   */
  async runAsSystem<T>(fn: () => T | Promise<T>, label = 'system'): Promise<T> {
    return storage.run(
      {
        tenantId: null,
        principalType: null,
        principalId: null,
        principalName: label,
        crossTenant: true,
      },
      async () => await fn(),
    );
  }

  /**
   * Run `fn` scoped to one tenant with no principal. For per-tenant work inside
   * a job that has already fanned out — keeps the guard active for the inner
   * queries rather than leaving the whole job cross-tenant.
   *
   * Async for the same reason as `runAsSystem` above.
   */
  async runAsTenant<T>(
    tenantId: string,
    fn: () => T | Promise<T>,
    label = 'system',
  ): Promise<T> {
    return storage.run(
      {
        tenantId,
        principalType: null,
        principalId: null,
        principalName: label,
        crossTenant: false,
      },
      async () => await fn(),
    );
  }
}

/** Module-level access for code that cannot take a constructor dependency. */
export const requestContext = {
  get: (): RequestContext | null => storage.getStore() ?? null,
};
