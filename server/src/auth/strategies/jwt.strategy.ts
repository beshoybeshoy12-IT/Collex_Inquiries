import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrincipalType, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestContextService } from '../../common/context/request-context';
import { requireEnv } from '../../common/config/env';
import { AuthCacheService } from '../auth-cache.service';
import { PermissionResolverService } from '../permission-resolver.service';
import { TokenService, JwtPayload } from '../token.service';
import {
  AuthenticatedInvestigator,
  AuthenticatedPrincipal,
  AuthenticatedUser,
} from '../../common/decorators/auth.decorators';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What every authenticated request is checked against.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  In order, and all of them:
 *
 *   1. the signature and expiry (passport, before this runs);
 *   2. the session named by `sid` exists, is not revoked, and has not expired;
 *   3. the principal exists and is ACTIVE;
 *   4. the tenant is ACTIVE and its subscription has not lapsed;
 *   5. the access token's `jti` is not on the denylist.
 *
 *  Steps 2–5 cost one query. The resolved result is cached for 30 seconds under
 *  `auth:<principalId>` — see `AuthCacheService` for why the key is per
 *  principal rather than per session, and for the two levers that undo it.
 *
 *  The session id is stored *inside* the cached value and compared on every
 *  hit. Keying the cache by session instead would mean a re-login wrote a new
 *  key and left the old one intact, so a session that had just been revoked
 *  would keep passing from cache until its TTL ran out.
 *
 *  Everything here runs unscoped, because resolving who is calling necessarily
 *  precedes knowing which tenant to scope to. The tenant is then taken from the
 *  loaded row — never from the token's `tid` alone — and the two are compared,
 *  so a token whose tenant claim no longer matches the database is rejected
 *  rather than trusted.
 */

interface CachedPrincipal {
  sessionId: string;
  principal: AuthenticatedPrincipal;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authCache: AuthCacheService,
    private readonly permissions: PermissionResolverService,
    private readonly tokens: TokenService,
    private readonly requestContext: RequestContextService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireEnv('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedPrincipal> {
    const cached = await this.authCache.get<CachedPrincipal>(payload.sub);

    if (cached) {
      // The cache is per principal, so a second session's token would otherwise
      // reuse the first's entry. Compare on every hit.
      if (cached.sessionId !== payload.sid) {
        await this.authCache.invalidatePrincipal(payload.sub);
      } else {
        const principal = { ...cached.principal, jti: payload.jti };
        this.bindContext(principal);
        return principal;
      }
    }

    // Only on a cache miss, so the denylist costs one indexed lookup per
    // principal per TTL rather than one per request.
    if (await this.tokens.isDenied(payload.jti)) {
      throw new UnauthorizedException('انتهت صلاحية الجلسة - Session ended');
    }

    // The type parameter is explicit: without it the ternary infers a union of
    // two promise types rather than a promise of the union.
    const principal = await this.authCache.runUnscoped<AuthenticatedPrincipal>(
      () =>
        payload.typ === PrincipalType.INVESTIGATOR
          ? this.loadInvestigator(payload)
          : this.loadWebUser(payload),
    );

    await this.authCache.set<CachedPrincipal>(payload.sub, {
      sessionId: payload.sid,
      principal,
    });

    const withToken = { ...principal, jti: payload.jti };
    this.bindContext(withToken);
    return withToken;
  }

  /**
   * Hand the principal to the ambient context, which is what the tenant guard
   * reads on every query. Until this runs the context is unscoped and the guard
   * refuses to touch a tenant-scoped table — so an auth path that fell through
   * without setting it fails loudly rather than reading across tenants.
   */
  private bindContext(principal: AuthenticatedPrincipal): void {
    this.requestContext.setPrincipal({
      tenantId: principal.tenantId,
      principalType: principal.principalType,
      principalId: principal.id,
      principalName: principal.fullName,
      // A super admin genuinely operates across tenants; nobody else does.
      crossTenant:
        principal.principalType === PrincipalType.WEB_USER &&
        (principal as AuthenticatedUser).isSuperAdmin,
    });
  }

  private async loadWebUser(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        tenantId: true,
        email: true,
        fullName: true,
        status: true,
        locale: true,
        isSuperAdmin: true,
        roleId: true,
        allowedGovernorateIds: true,
        deletedAt: true,
        role: {
          select: {
            code: true,
            rank: true,
            permissions: { select: { permissionCode: true } },
          },
        },
        permissionOverrides: {
          select: { permissionCode: true, granted: true },
        },
        tenant: {
          select: {
            id: true,
            status: true,
            subscriptionEnd: true,
            featureFlags: true,
          },
        },
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException(
        'الحساب لم يعد موجودًا - Account no longer exists',
      );
    }

    await this.assertSessionLive(payload);

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'الحساب غير مفعل - Account is not active',
      );
    }

    // A token minted before the user was moved between tenants would otherwise
    // carry the old claim into a scoped context.
    if (user.tenantId !== payload.tid) {
      throw new UnauthorizedException('جلسة غير صالحة - Invalid session');
    }

    this.assertTenantUsable(user.tenant, user.isSuperAdmin);

    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      fullName: user.fullName,
      principalType: PrincipalType.WEB_USER,
      roleId: user.roleId,
      roleCode: user.role?.code ?? null,
      roleRank: user.role?.rank ?? 0,
      isSuperAdmin: user.isSuperAdmin,
      permissions: this.permissions.applyTenantFlags(
        this.permissions.resolve(user),
        user.tenant?.featureFlags as Record<string, unknown> | null,
      ),
      allowedGovernorateIds: user.allowedGovernorateIds,
      locale: user.locale,
      sessionId: payload.sid,
    };
  }

  private async loadInvestigator(
    payload: JwtPayload,
  ): Promise<AuthenticatedInvestigator> {
    const investigator = await this.prisma.investigator.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        tenantId: true,
        employeeCode: true,
        fullName: true,
        status: true,
        locale: true,
        deletedAt: true,
        tenant: {
          select: { id: true, status: true, subscriptionEnd: true },
        },
      },
    });

    if (!investigator || investigator.deletedAt) {
      throw new UnauthorizedException(
        'الحساب لم يعد موجودًا - Account no longer exists',
      );
    }

    await this.assertSessionLive(payload);

    // IN_TRAINING can sign in — that is how training happens — but ACTIVE is
    // required to be assigned work, which the assignment service enforces.
    if (
      investigator.status === 'SUSPENDED' ||
      investigator.status === 'INACTIVE'
    ) {
      throw new UnauthorizedException(
        'الحساب غير مفعل - Account is not active',
      );
    }

    if (investigator.tenantId !== payload.tid) {
      throw new UnauthorizedException('جلسة غير صالحة - Invalid session');
    }

    this.assertTenantUsable(investigator.tenant, false);

    return {
      id: investigator.id,
      tenantId: investigator.tenantId,
      employeeCode: investigator.employeeCode,
      fullName: investigator.fullName,
      principalType: PrincipalType.INVESTIGATOR,
      locale: investigator.locale,
      sessionId: payload.sid,
    };
  }

  /**
   * The session behind this token must still be open.
   *
   * This is what makes "log out all devices" and "disable this user" take
   * effect immediately rather than at the access token's expiry, and it is why
   * the strategy is not purely stateless.
   */
  private async assertSessionLive(payload: JwtPayload): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { revokedAt: true, expiresAt: true },
    });

    if (!session) {
      throw new UnauthorizedException('جلسة غير صالحة - Invalid session');
    }
    if (session.revokedAt) {
      throw new UnauthorizedException('تم إنهاء الجلسة - Session was ended');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('انتهت صلاحية الجلسة - Session expired');
    }
  }

  /**
   * The tenant has to be usable, and a lapsed subscription is not.
   *
   * Super admins are exempt: somebody has to be able to sign in and renew it.
   */
  private assertTenantUsable(
    tenant:
      { status: TenantStatus; subscriptionEnd: Date | null } | null | undefined,
    isSuperAdmin: boolean,
  ): void {
    if (isSuperAdmin) return;

    if (!tenant || tenant.status === TenantStatus.SUSPENDED) {
      throw new UnauthorizedException(
        'تم إيقاف حساب الشركة - Company account is suspended',
      );
    }

    if (tenant.status === TenantStatus.EXPIRED) {
      throw new UnauthorizedException(
        'انتهى اشتراك الشركة - Company subscription has expired',
      );
    }

    if (
      tenant.subscriptionEnd &&
      tenant.subscriptionEnd.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException(
        'انتهى اشتراك الشركة - Company subscription has expired',
      );
    }
  }
}
