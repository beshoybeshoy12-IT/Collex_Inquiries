import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrincipalType } from '@prisma/client';
import {
  PERMISSIONS_KEY,
  PRINCIPAL_KEY,
  PUBLIC_KEY,
  AuthenticatedPrincipal,
  AuthenticatedUser,
} from '../decorators/auth.decorators';
import type { PermissionCode } from '../constants/permissions';

/**
 * Enforces `@RequirePermission` and `@AllowPrincipals`.
 *
 * Registered globally, unlike Collex System V1's equivalent — which had to be
 * per-controller because it read `req.user` and global guards run before the
 * auth guard. Here both are global and their order is fixed by registration
 * order in `app.module.ts`: `JwtAuthGuard` first, so the principal is on the
 * request by the time this runs.
 *
 * THE DEFAULT IS CLOSED FOR PRINCIPAL TYPE, OPEN FOR PERMISSIONS.
 *
 * A route with no `@RequirePermission` passes — plenty of endpoints (a user
 * reading their own profile, marking their own notification read) are
 * authenticated but need no grant. A route with no `@AllowPrincipals` is
 * web-user only, because an investigator holds no permissions at all and would
 * otherwise sail through every undecorated route. Mobile endpoints opt in
 * explicitly.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    // `@Public()` has to be re-checked here, not merely relied upon.
    //
    // Global guards do not short-circuit one another: `JwtAuthGuard` returning
    // true for a public route does not stop this one running, and it leaves no
    // principal on the request — so without this check every public route
    // (login, refresh, the health probes) would 403. That is exactly how it
    // failed the first time it was booted.
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_KEY,
      targets,
    );
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<PermissionCode[]>(
      PERMISSIONS_KEY,
      targets,
    );
    const allowedPrincipals = this.reflector.getAllAndOverride<PrincipalType[]>(
      PRINCIPAL_KEY,
      targets,
    ) ?? [PrincipalType.WEB_USER];

    const request = context.switchToHttp().getRequest();
    const principal = request.user as AuthenticatedPrincipal | undefined;

    // A public route returns above, so a missing principal here means the auth
    // guard did not run — a wiring mistake, and refusing is the only safe
    // reading of it.
    if (!principal) {
      throw new ForbiddenException('غير مصرح - Not authorized');
    }

    // Principal type is checked first and always. This is the gate that keeps
    // an investigator's token out of the back-office routes.
    if (!allowedPrincipals.includes(principal.principalType)) {
      throw new ForbiddenException(
        'هذا الإجراء غير متاح لهذا النوع من الحسابات - ' +
          'This action is not available for this account type',
      );
    }

    if (!required || required.length === 0) return true;

    /**
     * PERMISSIONS ARE A WEB-USER CONCEPT, and a non-web principal that the
     * route explicitly admits is past the only gate that applies to it.
     *
     * Several routes serve both audiences — reading a case, its GPS track, its
     * form — and carry a `@RequirePermission` for the office plus an
     * `@AllowPrincipals(..., INVESTIGATOR)` for the field. Investigators hold
     * no permissions at all, so refusing them here would make every shared
     * route unreachable from the mobile client: exactly what happened the first
     * time this ran.
     *
     * THE CONTRACT THIS CREATES: on any route that admits an investigator, the
     * service is responsible for scoping the data to that investigator. Every
     * one of them does — `InvestigationsService.findVisible`, `GpsService`,
     * `SubmissionsService.assertCanAnswer` and `MediaService` all filter on
     * `investigatorId` from the token, so an investigator sees their own
     * assignments and nothing else. A new investigator-facing route must do the
     * same; passing the principal-type gate is not the same as being allowed to
     * read everything behind it.
     */
    if (principal.principalType !== PrincipalType.WEB_USER) {
      return true;
    }

    const user = principal as AuthenticatedUser;

    // The platform operator bypass. Not a permission, not grantable, and the
    // only role-shaped check in the system.
    if (user.isSuperAdmin) return true;

    const held = new Set(user.permissions ?? []);
    if (required.some((permission) => held.has(permission))) return true;

    throw new ForbiddenException(
      'ليس لديك صلاحية تنفيذ هذا الإجراء - You do not have permission to perform this action',
    );
  }
}
