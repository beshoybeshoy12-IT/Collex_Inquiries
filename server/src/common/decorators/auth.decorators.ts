import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { PrincipalType } from '@prisma/client';
import type { PermissionCode } from '../constants/permissions';

export const PUBLIC_KEY = 'authz:public';
export const PERMISSIONS_KEY = 'authz:permissions';
export const PRINCIPAL_KEY = 'authz:principal';

/**
 * Skip authentication for this route.
 *
 * Named as an exception rather than a default: `JwtAuthGuard` is registered
 * globally, so every route is protected unless it says otherwise here. A new
 * endpoint that its author forgot to think about is closed, not open.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Require one or more permissions. Several names are OR'd — a handful of
 * endpoints are reached from two screens that a tenant may gate differently,
 * and requiring both would lock out whoever legitimately has only one.
 *
 *   @RequirePermission(P.INVESTIGATIONS_ASSIGN)
 *   @RequirePermission(P.QC_APPROVE, P.QC_REJECT)
 *
 * The argument type is `PermissionCode`, so a misspelled permission is a
 * compile error rather than a guard that never matches and quietly passes
 * nobody — or, worse, a guard someone then "fixes" by removing.
 */
export const RequirePermission = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Restrict a route to one kind of principal.
 *
 * The mobile endpoints are `@AllowPrincipals(PrincipalType.INVESTIGATOR)` and
 * the back-office ones are web-only. Without this an investigator's token
 * would be accepted by every route whose permission check they happen to pass
 * — and investigators hold no permissions at all, so "no permission required"
 * routes would be wide open to them.
 */
export const AllowPrincipals = (...types: PrincipalType[]) =>
  SetMetadata(PRINCIPAL_KEY, types);

/** The authenticated web user, as resolved by `JwtStrategy`. */
export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  principalType: PrincipalType;
  roleId: string | null;
  roleCode: string | null;
  roleRank: number;
  isSuperAdmin: boolean;
  /** Effective permissions: role grants plus overrides, already resolved. */
  permissions: string[];
  allowedGovernorateIds: string[];
  locale: string;
  /** Present on access tokens so logout can deny this exact token. */
  jti?: string;
  sessionId?: string;
}

/** The authenticated field investigator. */
export interface AuthenticatedInvestigator {
  id: string;
  tenantId: string;
  employeeCode: string;
  fullName: string;
  principalType: PrincipalType;
  locale: string;
  jti?: string;
  sessionId?: string;
}

export type AuthenticatedPrincipal =
  AuthenticatedUser | AuthenticatedInvestigator;

/** Narrowing helper — `principalType` is the discriminant. */
export const isWebUser = (
  principal: AuthenticatedPrincipal,
): principal is AuthenticatedUser =>
  principal.principalType === PrincipalType.WEB_USER;

/**
 * The authenticated principal, or one property of it.
 *
 *   findAll(@CurrentUser() user: AuthenticatedUser)
 *   findAll(@CurrentUser('tenantId') tenantId: string)
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    return data ? user?.[data] : user;
  },
);

/**
 * The caller's tenant, taken from the verified token and never from the
 * request body.
 *
 * This is the decorator every tenant-scoped controller uses. Accepting a
 * tenant id as a parameter — even "just for admin tools" — is the one change
 * that would undo the whole isolation model, so there is deliberately no DTO
 * anywhere in this codebase with a `tenantId` field.
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.tenantId;
  },
);

/** Request metadata for audit rows, so controllers do not dig into `req`. */
export const RequestInfo = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return {
      ip: request.ip as string | undefined,
      userAgent: request.headers?.['user-agent'] as string | undefined,
      requestId: request.id as string | undefined,
    };
  },
);
