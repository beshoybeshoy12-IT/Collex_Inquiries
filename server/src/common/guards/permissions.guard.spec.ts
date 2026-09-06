import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrincipalType } from '@prisma/client';
import { PermissionsGuard } from './permissions.guard';
import { P } from '../constants/permissions';
import {
  PERMISSIONS_KEY,
  PRINCIPAL_KEY,
  PUBLIC_KEY,
  AuthenticatedPrincipal,
} from '../decorators/auth.decorators';

/**
 * The guard decides who reaches what, so its rules are pinned down here rather
 * than left to be rediscovered. Three of these tests exist because the first
 * boot of the API failed on exactly that behaviour:
 *
 *  - a `@Public()` route must pass (global guards do not short-circuit each
 *    other, so this guard sees no principal on login and the health probes);
 *  - an investigator on a route that admits them must pass even though it
 *    carries a `@RequirePermission` for the office;
 *  - an investigator on a route that does NOT admit them must still be refused.
 */

function contextWith(
  metadata: Record<string, unknown>,
  principal?: AuthenticatedPrincipal,
): { context: ExecutionContext; reflector: Reflector } {
  const reflector = {
    getAllAndOverride: (key: string) => metadata[key],
  } as unknown as Reflector;

  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: principal }) }),
  } as unknown as ExecutionContext;

  return { context, reflector };
}

const webUser = (
  permissions: string[],
  isSuperAdmin = false,
): AuthenticatedPrincipal => ({
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'u@example.com',
  fullName: 'User',
  principalType: PrincipalType.WEB_USER,
  roleId: 'role-1',
  roleCode: 'COORDINATOR',
  roleRank: 50,
  isSuperAdmin,
  permissions,
  allowedGovernorateIds: [],
  locale: 'ar',
});

const investigator = (): AuthenticatedPrincipal => ({
  id: 'inv-1',
  tenantId: 'tenant-1',
  employeeCode: 'INV-001',
  fullName: 'Investigator',
  principalType: PrincipalType.INVESTIGATOR,
  locale: 'ar',
});

function run(
  metadata: Record<string, unknown>,
  principal?: AuthenticatedPrincipal,
): boolean {
  const { context, reflector } = contextWith(metadata, principal);
  return new PermissionsGuard(reflector).canActivate(context);
}

describe('PermissionsGuard', () => {
  describe('public routes', () => {
    it('lets a public route through with no principal at all', () => {
      // Global guards do not short-circuit one another: JwtAuthGuard returning
      // true for @Public() leaves no user on the request, and this guard runs
      // anyway. Without this check, login and the health probes 403.
      expect(run({ [PUBLIC_KEY]: true })).toBe(true);
    });

    it('lets a public route through even when it declares permissions', () => {
      expect(
        run({ [PUBLIC_KEY]: true, [PERMISSIONS_KEY]: [P.USERS_VIEW] }),
      ).toBe(true);
    });
  });

  describe('authentication', () => {
    it('refuses a non-public route with no principal', () => {
      expect(() => run({})).toThrow(ForbiddenException);
    });
  });

  describe('principal type', () => {
    it('defaults to web users only', () => {
      // A route that says nothing about principals is back-office. An
      // investigator holds no permissions, so an open default would make every
      // undecorated route reachable from a handset.
      expect(() => run({}, investigator())).toThrow(ForbiddenException);
    });

    it('admits an investigator where the route says so', () => {
      expect(
        run(
          {
            [PRINCIPAL_KEY]: [
              PrincipalType.WEB_USER,
              PrincipalType.INVESTIGATOR,
            ],
          },
          investigator(),
        ),
      ).toBe(true);
    });

    it('refuses a web user on an investigator-only route', () => {
      expect(() =>
        run(
          { [PRINCIPAL_KEY]: [PrincipalType.INVESTIGATOR] },
          webUser([P.INVESTIGATIONS_VIEW]),
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('permissions', () => {
    it('allows a route with no permission declared', () => {
      expect(run({}, webUser([]))).toBe(true);
    });

    it('allows a user holding the required permission', () => {
      expect(
        run(
          { [PERMISSIONS_KEY]: [P.INVESTIGATIONS_ASSIGN] },
          webUser([P.INVESTIGATIONS_VIEW, P.INVESTIGATIONS_ASSIGN]),
        ),
      ).toBe(true);
    });

    it('refuses a user who does not hold it', () => {
      expect(() =>
        run(
          { [PERMISSIONS_KEY]: [P.INVESTIGATIONS_ASSIGN] },
          webUser([P.INVESTIGATIONS_VIEW]),
        ),
      ).toThrow(ForbiddenException);
    });

    it('treats several permissions as OR', () => {
      // Some endpoints are reached from two screens a tenant may gate
      // differently; requiring both would lock out whoever holds only one.
      expect(
        run(
          { [PERMISSIONS_KEY]: [P.QC_APPROVE, P.QC_REJECT] },
          webUser([P.QC_REJECT]),
        ),
      ).toBe(true);
    });

    it('lets a super admin past any permission', () => {
      expect(
        run({ [PERMISSIONS_KEY]: [P.TENANT_MANAGE] }, webUser([], true)),
      ).toBe(true);
    });
  });

  describe('investigators on shared routes', () => {
    it('passes the permission gate on a route that admits them', () => {
      // Reading a case, its GPS track and its form are all shared routes that
      // carry a web-side permission. Investigators hold no permissions, so
      // refusing here would make the whole mobile API unreachable — which is
      // exactly how this failed the first time it was run.
      expect(
        run(
          {
            [PRINCIPAL_KEY]: [
              PrincipalType.WEB_USER,
              PrincipalType.INVESTIGATOR,
            ],
            [PERMISSIONS_KEY]: [P.INVESTIGATIONS_VIEW],
          },
          investigator(),
        ),
      ).toBe(true);
    });

    it('is still refused on a route that does not admit them', () => {
      // The principal-type gate runs first and is what actually protects the
      // back office. Passing the permission gate must not weaken it.
      expect(() =>
        run({ [PERMISSIONS_KEY]: [P.USERS_VIEW] }, investigator()),
      ).toThrow(ForbiddenException);
    });
  });
});
