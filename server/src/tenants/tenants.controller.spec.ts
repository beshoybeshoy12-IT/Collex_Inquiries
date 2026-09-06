import { ForbiddenException } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Who may create a company
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The platform routes are gated on `isSuperAdmin` in the controller rather
 *  than with `@RequirePermission`, and the difference is the whole point:
 *
 *    · A PERMISSION IS A ROW. Somebody can grant it. `PermissionsGuard`
 *      already returns true for a super admin on every permission it is asked
 *      about, so a `tenants.manage` permission would be satisfied both by the
 *      operator AND by any company administrator who was granted it — and
 *      granting a company administrator every permission is the normal,
 *      intended configuration. The seeded COMPANY_ADMIN role holds all of
 *      them.
 *
 *    · `isSuperAdmin` IS A COLUMN WITH NO WRITE PATH. No DTO exposes it, no
 *      service sets it; it is granted by `prisma/seed-platform-admin.ts`,
 *      which needs shell access to the database.
 *
 *  So the test that matters most below is not "a random user is refused" — it
 *  is that a principal holding EVERY permission in the catalogue is still
 *  refused. That is the case a well-meaning permission-based gate would let
 *  through, and it is the one the product cannot survive: one customer able to
 *  read every other customer's company list, raise its own plan limits, or
 *  suspend a competitor.
 */
describe('TenantsController — the platform-operator gate', () => {
  const service = {
    getOwn: jest.fn(),
    updateOwn: jest.fn(),
    updateSettings: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    setStatus: jest.fn(),
    setLimits: jest.fn(),
  };

  const controller = new TenantsController(
    service as unknown as TenantsService,
  );

  const principal = (overrides: Partial<AuthenticatedUser> = {}) =>
    ({
      id: 'u1',
      tenantId: 't1',
      email: 'someone@example.test',
      isSuperAdmin: false,
      ...overrides,
    }) as AuthenticatedUser;

  const operator = principal({ id: 'op', isSuperAdmin: true });

  /** Every route that must never be reachable without `isSuperAdmin`. */
  const platformRoutes: [string, (user: AuthenticatedUser) => unknown][] = [
    ['GET /tenants', (user) => controller.findAll(user)],
    [
      'POST /tenants',
      (user) =>
        controller.create(user, {
          code: 'ACME',
          nameAr: 'أكمي',
          nameEn: 'Acme',
          adminEmail: 'admin@acme.test',
          adminName: 'Admin',
        }),
    ],
    [
      'PATCH /tenants/:id/status',
      (user) =>
        controller.setStatus(user, 'other-tenant', {
          status: TenantStatus.SUSPENDED,
        }),
    ],
    [
      'PATCH /tenants/:id/limits',
      (user) =>
        controller.setLimits(user, 'other-tenant', { maxWebUsers: 100_000 }),
    ],
  ];

  beforeEach(() => jest.clearAllMocks());

  describe.each(platformRoutes)('%s', (_name, call) => {
    it('refuses an ordinary user', () => {
      expect(() => call(principal())).toThrow(ForbiddenException);
    });

    it('refuses a company administrator holding every permission', () => {
      // The regression this file exists for. `can()` and `PermissionsGuard`
      // cannot separate this principal from the operator; only the column can.
      expect(() =>
        call(
          principal({
            roleCode: 'COMPANY_ADMIN',
            roleRank: 100,
            permissions: ['*every permission in the catalogue*'],
          } as Partial<AuthenticatedUser>),
        ),
      ).toThrow(ForbiddenException);
    });

    it('refuses before touching the service', () => {
      expect(() => call(principal())).toThrow(ForbiddenException);

      // A gate that refuses AFTER the work is done still did the work. Nothing
      // may reach the service on the refused path — `create` in particular
      // writes a company, roles and a user.
      for (const spy of Object.values(service)) {
        expect(spy).not.toHaveBeenCalled();
      }
    });

    it('says so in Arabic and in English', () => {
      try {
        call(principal());
      } catch (error) {
        const message = (error as ForbiddenException).message;
        expect(message).toMatch(/[؀-ۿ]/);
        expect(message).toMatch(/[A-Za-z]/);
        // The separator `localiseServerMessage()` splits on.
        expect(message.split(' - ')).toHaveLength(2);
      }
      expect.assertions(3);
    });

    it('lets the platform operator through', () => {
      expect(() => call(operator)).not.toThrow();
    });
  });

  describe('the routes a company uses on itself', () => {
    // These must NOT be behind the operator gate, or a company administrator
    // could not read or edit their own profile. They are permission-gated by
    // the decorators, which `PermissionsGuard` enforces.

    it('lets an ordinary user read their own company', () => {
      controller.getOwn('t1');
      expect(service.getOwn).toHaveBeenCalledWith('t1');
    });

    it('takes the tenant from the request context, never from the body', () => {
      const user = principal();
      controller.updateOwn('t1', user, { nameEn: 'Renamed' });

      // `@TenantId()` resolves from the verified token. If this ever became a
      // body field, one company could rename another.
      expect(service.updateOwn).toHaveBeenCalledWith('t1', user, {
        nameEn: 'Renamed',
      });
    });

    it('lets an ordinary user edit their own settings', () => {
      controller.updateSettings('t1', { featureFlags: { qc: false } });
      expect(service.updateSettings).toHaveBeenCalledWith('t1', {
        featureFlags: { qc: false },
      });
    });
  });

  describe('what the operator actually asked for', () => {
    it('passes the status and the reason through', () => {
      controller.setStatus(operator, 'tenant-9', {
        status: TenantStatus.SUSPENDED,
        reason: 'unpaid invoice',
      });

      expect(service.setStatus).toHaveBeenCalledWith(
        'tenant-9',
        TenantStatus.SUSPENDED,
        'unpaid invoice',
      );
    });

    it('passes limits through untouched', () => {
      const limits = { maxWebUsers: 25, maxInvestigators: 80 };
      controller.setLimits(operator, 'tenant-9', limits);
      expect(service.setLimits).toHaveBeenCalledWith('tenant-9', limits);
    });
  });
});
