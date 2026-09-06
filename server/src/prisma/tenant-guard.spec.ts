import { Prisma } from '@prisma/client';
import {
  AllOperationsHook,
  buildTenantGuardHook,
  MissingTenantContextError,
  TENANT_SCOPED_MODELS,
} from './tenant-guard';
import type { RequestContext } from '../common/context/request-context';

/**
 * The guard is the single thing standing between one bank's customers and
 * another's, so it is tested against the real DMMF rather than a fixture: if
 * `prisma generate` produces a schema where a model lost its `tenantId`, these
 * tests fail rather than the guard quietly skipping that model.
 *
 * The extension itself is exercised by calling the `$allOperations` hook the
 * way Prisma would, which keeps the whole suite database-free.
 */

/** The hook Prisma would call, bound to a fixed context. */
function hookFrom(
  context: RequestContext | null,
  warn = false,
): AllOperationsHook {
  return buildTenantGuardHook({
    getContext: () => context,
    warnOnInjection: warn,
  });
}

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const webUserContext = (tenantId: string): RequestContext => ({
  tenantId,
  principalType: 'WEB_USER',
  principalId: 'user-1',
  principalName: 'Coordinator',
  crossTenant: false,
});

/** Captures what the guard actually handed to Prisma. */
function spyQuery() {
  const calls: unknown[] = [];
  const query = (args: unknown) => {
    calls.push(args);
    return Promise.resolve('ok');
  };
  return { calls, query };
}

describe('TENANT_SCOPED_MODELS', () => {
  it('is derived from the schema, not a hand-written list', () => {
    const fromDmmf = Prisma.dmmf.datamodel.models
      .filter((m) =>
        m.fields.some((f) => f.name === 'tenantId' && f.kind === 'scalar'),
      )
      .map((m) => m.name)
      .sort();

    expect([...TENANT_SCOPED_MODELS].sort()).toEqual(fromDmmf);
  });

  it('covers every model that holds tenant data', () => {
    // A regression here means a table full of one tenant's data stopped being
    // filtered. Spot-checked explicitly rather than trusting the derivation.
    for (const model of [
      'User',
      'Investigator',
      'Customer',
      'Investigation',
      'Assignment',
      'MediaAsset',
      'GpsEvent',
      'QcReview',
      'Report',
      'ImportBatch',
      'ImportRow',
      'FormTemplate',
      'FormVersion',
      'FormSubmission',
      'Notification',
      'AuditLog',
      'ExportJob',
      'Product',
      'InvestigationType',
    ]) {
      expect(TENANT_SCOPED_MODELS.has(model)).toBe(true);
    }
  });

  it('leaves shared reference data unscoped', () => {
    // These are one catalogue shared by every tenant. Scoping them would mean
    // each tenant inventing its own idea of what Cairo is.
    for (const model of [
      'Tenant',
      'Permission',
      'Governorate',
      'City',
      'District',
      'Area',
      'RevokedToken',
      'CronLock',
    ]) {
      expect(TENANT_SCOPED_MODELS.has(model)).toBe(false);
    }
  });
});

describe('tenantGuardExtension', () => {
  describe('when no context is bound', () => {
    it('throws rather than running a tenant-scoped query unfiltered', async () => {
      const hook = hookFrom(null);
      const { query } = spyQuery();

      await expect(
        hook({
          model: 'Customer',
          operation: 'findMany',
          args: {},
          query,
        }),
      ).rejects.toBeInstanceOf(MissingTenantContextError);
    });

    it('still allows unscoped models through', async () => {
      const hook = hookFrom(null);
      const { calls, query } = spyQuery();

      await expect(
        hook({ model: 'Governorate', operation: 'findMany', args: {}, query }),
      ).resolves.toBe('ok');
      expect(calls).toHaveLength(1);
    });
  });

  describe('read operations', () => {
    it.each([
      'findMany',
      'findFirst',
      'findFirstOrThrow',
      'count',
      'aggregate',
      'groupBy',
    ])('adds the tenant filter to %s', async (operation) => {
      const hook = hookFrom(webUserContext(TENANT_A));
      const { calls, query } = spyQuery();

      await hook({ model: 'Investigation', operation, args: {}, query });

      expect(calls[0]).toEqual({ where: { tenantId: TENANT_A } });
    });

    it('preserves the filters the caller already wrote', async () => {
      const hook = hookFrom(webUserContext(TENANT_A));
      const { calls, query } = spyQuery();

      await hook({
        model: 'Investigation',
        operation: 'findMany',
        args: {
          where: { status: 'NEW' },
          take: 20,
          orderBy: { createdAt: 'desc' },
        },
        query,
      });

      expect(calls[0]).toEqual({
        where: { status: 'NEW', tenantId: TENANT_A },
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('does not rewrite an explicit tenantId the service already passed', async () => {
      // The normal case: the service scoped it properly. The guard must be a
      // no-op here, or an intentional cross-tenant read by a super admin
      // service would be silently narrowed.
      const hook = hookFrom(webUserContext(TENANT_A));
      const { calls, query } = spyQuery();

      await hook({
        model: 'Customer',
        operation: 'findMany',
        args: { where: { tenantId: TENANT_A, fullName: 'Ahmed' } },
        query,
      });

      expect(calls[0]).toEqual({
        where: { tenantId: TENANT_A, fullName: 'Ahmed' },
      });
    });

    it('scopes findUnique, so a guessed id from another tenant returns nothing', async () => {
      const hook = hookFrom(webUserContext(TENANT_B));
      const { calls, query } = spyQuery();

      await hook({
        model: 'Investigation',
        operation: 'findUnique',
        args: { where: { id: 'case-owned-by-tenant-a' } },
        query,
      });

      expect(calls[0]).toEqual({
        where: { id: 'case-owned-by-tenant-a', tenantId: TENANT_B },
      });
    });
  });

  describe('write operations', () => {
    it('fills tenantId into a create', async () => {
      const hook = hookFrom(webUserContext(TENANT_A));
      const { calls, query } = spyQuery();

      await hook({
        model: 'Customer',
        operation: 'create',
        args: { data: { fullName: 'Mona' } },
        query,
      });

      expect(calls[0]).toEqual({
        data: { fullName: 'Mona', tenantId: TENANT_A },
      });
    });

    it('fills tenantId into every row of a createMany', async () => {
      const hook = hookFrom(webUserContext(TENANT_A));
      const { calls, query } = spyQuery();

      await hook({
        model: 'ImportRow',
        operation: 'createMany',
        args: { data: [{ rowNumber: 1 }, { rowNumber: 2 }] },
        query,
      });

      expect(calls[0]).toEqual({
        data: [
          { rowNumber: 1, tenantId: TENANT_A },
          { rowNumber: 2, tenantId: TENANT_A },
        ],
      });
    });

    it('leaves an explicit tenant relation alone', async () => {
      const hook = hookFrom(webUserContext(TENANT_A));
      const { calls, query } = spyQuery();

      await hook({
        model: 'Customer',
        operation: 'create',
        args: {
          data: { fullName: 'Mona', tenant: { connect: { id: TENANT_A } } },
        },
        query,
      });

      expect(calls[0]).toEqual({
        data: { fullName: 'Mona', tenant: { connect: { id: TENANT_A } } },
      });
    });

    it('scopes update, so another tenant cannot write through a known id', async () => {
      const hook = hookFrom(webUserContext(TENANT_B));
      const { calls, query } = spyQuery();

      await hook({
        model: 'Investigation',
        operation: 'update',
        args: {
          where: { id: 'case-owned-by-tenant-a' },
          data: { priority: 'URGENT' },
        },
        query,
      });

      expect(calls[0]).toEqual({
        where: { id: 'case-owned-by-tenant-a', tenantId: TENANT_B },
        data: { priority: 'URGENT' },
      });
    });

    it('scopes delete and deleteMany', async () => {
      const hook = hookFrom(webUserContext(TENANT_B));
      const { calls, query } = spyQuery();

      await hook({
        model: 'Customer',
        operation: 'delete',
        args: { where: { id: 'x' } },
        query,
      });
      await hook({
        model: 'Customer',
        operation: 'deleteMany',
        args: { where: { fullName: 'Mona' } },
        query,
      });

      expect(calls[0]).toEqual({ where: { id: 'x', tenantId: TENANT_B } });
      expect(calls[1]).toEqual({
        where: { fullName: 'Mona', tenantId: TENANT_B },
      });
    });

    it('scopes both halves of an upsert', async () => {
      const hook = hookFrom(webUserContext(TENANT_A));
      const { calls, query } = spyQuery();

      await hook({
        model: 'Customer',
        operation: 'upsert',
        args: {
          where: { id: 'c1' },
          create: { fullName: 'Mona' },
          update: { fullName: 'Mona A.' },
        },
        query,
      });

      expect(calls[0]).toEqual({
        where: { id: 'c1', tenantId: TENANT_A },
        create: { fullName: 'Mona', tenantId: TENANT_A },
        update: { fullName: 'Mona A.' },
      });
    });
  });

  describe('cross-tenant contexts', () => {
    it('lets a system job read across tenants', async () => {
      const hook = hookFrom({
        tenantId: null,
        principalType: null,
        principalId: null,
        principalName: 'sla-sweep',
        crossTenant: true,
      });
      const { calls, query } = spyQuery();

      await hook({
        model: 'Investigation',
        operation: 'findMany',
        args: { where: { status: 'ASSIGNED' } },
        query,
      });

      expect(calls[0]).toEqual({ where: { status: 'ASSIGNED' } });
    });

    it('rejects a context that is neither cross-tenant nor scoped', async () => {
      // A half-populated context is a bug in whoever built it. Failing closed
      // is the only safe reading.
      const hook = hookFrom({
        tenantId: null,
        principalType: 'WEB_USER',
        principalId: 'user-1',
        principalName: 'x',
        crossTenant: false,
      });
      const { query } = spyQuery();

      await expect(
        hook({ model: 'Customer', operation: 'findMany', args: {}, query }),
      ).rejects.toBeInstanceOf(MissingTenantContextError);
    });
  });

  describe('isolation, end to end through the hook', () => {
    it('never lets tenant B see a filter for tenant A', async () => {
      const hookA = hookFrom(webUserContext(TENANT_A));
      const hookB = hookFrom(webUserContext(TENANT_B));
      const a = spyQuery();
      const b = spyQuery();

      const args = { where: { status: 'COMPLETED' } };
      await hookA({
        model: 'Investigation',
        operation: 'findMany',
        args: { ...args },
        query: a.query,
      });
      await hookB({
        model: 'Investigation',
        operation: 'findMany',
        args: { ...args },
        query: b.query,
      });

      expect(a.calls[0]).toEqual({
        where: { status: 'COMPLETED', tenantId: TENANT_A },
      });
      expect(b.calls[0]).toEqual({
        where: { status: 'COMPLETED', tenantId: TENANT_B },
      });
    });
  });
});
