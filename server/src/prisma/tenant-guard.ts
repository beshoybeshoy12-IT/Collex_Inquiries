import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '../common/context/request-context';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The tenant safety net.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Collex System V1 threads `companyId` by hand through controller → service →
 *  repository, and its own documentation admits the consequence: "a new query
 *  that omits companyId leaks across tenants." That is a design where the
 *  worst bug in the system is one forgotten argument away, in code nobody
 *  reviews twice because it looks like every other query.
 *
 *  This extension makes the filter automatic. Services still pass `tenantId`
 *  explicitly — that is what makes the code readable, and what the tests
 *  assert — but if one ever forgets, the query is still scoped, and the
 *  omission is logged as a defect rather than shipped as a leak.
 *
 *  WHAT IS GUARDED
 *
 *  Every model that declares a `tenantId` scalar, discovered from the DMMF at
 *  load time rather than from a hand-maintained list. Add a model with a
 *  `tenantId` column and it is guarded the moment `prisma generate` runs;
 *  there is no second place to remember to update.
 *
 *  HOW
 *
 *  - reads and bulk writes: `tenantId` is merged into `where`.
 *  - `findUnique` / `update` / `delete`: also merged into `where`. Prisma has
 *    accepted non-unique filters alongside the unique one since v5
 *    (`extendedWhereUnique`), so a lookup by primary key is still a primary-key
 *    lookup — it simply returns null for another tenant's row instead of that
 *    tenant's data.
 *  - `create` / `createMany` / `upsert`: `tenantId` is filled into the payload
 *    when absent, so a row cannot be written into the wrong tenant either.
 *  - `aggregate` / `groupBy` / `count`: merged into `where`, because a count
 *    that includes other tenants is a leak with a smaller payload.
 *
 *  WHAT IS NOT GUARDED, AND WHY THAT IS SAFE
 *
 *  - `$queryRaw`. An extension cannot parse SQL. Raw queries against
 *    tenant-scoped tables must carry their own filter; there is one, in
 *    `analytics`, and it is reviewed as such.
 *  - Models with no `tenantId`: the geography catalogue, the permission
 *    catalogue, `Tenant` itself. Shared reference data, deliberately.
 *  - Anything running under `runAsSystem()`. Cron sweeps and workers read
 *    across tenants by definition. That path is a named function, not an
 *    absent context.
 *
 *  A MISSING CONTEXT IS AN ERROR, NOT A BYPASS
 *
 *  If no context is bound at all, the guard throws rather than running the
 *  query unscoped. The failure mode of a forgotten `RequestContextInterceptor`
 *  has to be "this endpoint 500s in the first test", not "this endpoint
 *  returns every tenant's customers".
 */

const logger = new Logger('TenantGuard');

/** Operations whose `where` clause should carry the tenant filter. */
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** Operations that write a new row and therefore need `tenantId` in `data`. */
const CREATE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
]);

/**
 * Model names carrying a `tenantId` scalar, read from the generated DMMF.
 *
 * Computed once at module load. Exported so the test suite can assert the set
 * is what the schema says it is — a model that loses its `tenantId` column in a
 * refactor should fail a test, not quietly leave the guard.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) =>
      model.fields.some(
        (field) => field.name === 'tenantId' && field.kind === 'scalar',
      ),
    )
    .map((model) => model.name),
);

/** Thrown when a tenant-scoped query runs with no request context bound. */
export class MissingTenantContextError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model}.${operation}() ran with no request context. Tenant-scoped ` +
        `queries must run inside RequestContextService.run(), runAsTenant() ` +
        `or runAsSystem(). This is a wiring bug, not a user error.`,
    );
    this.name = 'MissingTenantContextError';
  }
}

/** Merge `tenantId` into a `where` object without disturbing what is there. */
function scopeWhere(where: unknown, tenantId: string): Record<string, unknown> {
  const base = (where ?? {}) as Record<string, unknown>;

  // Already scoped by the service — the normal case. Leave it alone so an
  // explicit filter is never silently rewritten.
  if (base.tenantId !== undefined) return base;

  return { ...base, tenantId };
}

/**
 * Fill `tenantId` into a create payload. `createMany` takes an array; both
 * shapes are handled, and an explicit value always wins so a super admin
 * creating on a tenant's behalf still works.
 */
function scopeCreateData(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => scopeCreateData(row, tenantId));
  }
  if (data && typeof data === 'object') {
    const row = data as Record<string, unknown>;
    // A nested `tenant: { connect: ... }` is an explicit choice too.
    if (row.tenantId !== undefined || row.tenant !== undefined) return row;
    return { ...row, tenantId };
  }
  return data;
}

interface GuardOptions {
  /** How to reach the ambient context. Injected so tests can drive it. */
  getContext: () => RequestContext | null;
  /**
   * Whether to log every injection. On in development so a forgotten filter
   * shows up while it is still cheap to fix; off in production, where the
   * injection has already done its job and the log line would be noise on a
   * hot path.
   */
  warnOnInjection: boolean;
}

/** The signature Prisma calls for every model operation. */
export type AllOperationsHook = (params: {
  model: string;
  operation: string;
  args: Record<string, unknown>;
  query: (args: unknown) => Promise<unknown>;
}) => Promise<unknown>;

/**
 * The guard itself, as the plain hook.
 *
 * Separated from `tenantGuardExtension` below because `Prisma.defineExtension`
 * returns an opaque function — there is no way to reach the hook back out of
 * it, and a rule this important must be testable without standing up a
 * database. `tenant-guard.spec.ts` drives this directly.
 *
 * Kept as a factory taking its context accessor rather than importing the
 * singleton, so the tests need no AsyncLocalStorage either.
 */
export function buildTenantGuardHook({
  getContext,
  warnOnInjection,
}: GuardOptions): AllOperationsHook {
  return async function tenantGuardHook({ model, operation, args, query }) {
    if (!TENANT_SCOPED_MODELS.has(model)) {
      return query(args);
    }

    const context = getContext();

    if (!context) {
      throw new MissingTenantContextError(model, operation);
    }

    // Platform operators and background sweeps read across tenants by design.
    // This is the only bypass, and it is always deliberate.
    if (context.crossTenant) {
      return query(args);
    }

    if (!context.tenantId) {
      throw new MissingTenantContextError(model, operation);
    }

    const tenantId = context.tenantId;
    const next = { ...args };

    if (WHERE_OPERATIONS.has(operation)) {
      const before = (next.where ?? {}) as Record<string, unknown>;
      if (before.tenantId === undefined && warnOnInjection) {
        logger.warn(
          `${model}.${operation}() did not scope by tenantId — the guard ` +
            `added it. Pass tenantId explicitly at the call site.`,
        );
      }
      next.where = scopeWhere(next.where, tenantId);
    } else if (CREATE_OPERATIONS.has(operation)) {
      next.data = scopeCreateData(next.data, tenantId);
    } else if (operation === 'upsert') {
      next.where = scopeWhere(next.where, tenantId);
      next.create = scopeCreateData(next.create, tenantId);
    }

    return query(next);
  };
}

/** Wrap the hook as a Prisma client extension, ready for `$extends`. */
export function tenantGuardExtension(options: GuardOptions) {
  const hook = buildTenantGuardHook(options);

  return Prisma.defineExtension({
    name: 'tenant-guard',
    query: {
      $allModels: {
        $allOperations: (params) =>
          hook(params as Parameters<AllOperationsHook>[0]),
      },
    },
  });
}
