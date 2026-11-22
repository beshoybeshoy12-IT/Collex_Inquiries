import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PrincipalType, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { TokenService, SessionOrigin, IssuedTokens } from './token.service';
import { AuthCacheService } from './auth-cache.service';
import { PermissionResolverService } from './permission-resolver.service';
import { AuditService } from '../audit/audit.service';
import { PushService } from '../push/push.service';
import { envInt } from '../common/config/env';
import {
  InvestigatorLoginDto,
  LoginDto,
  ChangePasswordDto,
} from './dto/auth.dto';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Sign-in, sign-out and the lockout policy.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  A rule that shapes several methods below: FAILED SIGN-IN NEVER SAYS WHY.
 *  "No such account", "wrong password" and "account disabled" are one message,
 *  because the difference between them is an account-enumeration oracle — and
 *  the population here is small and guessable (staff of one collection agency),
 *  which makes enumeration cheap and worth doing.
 *
 *  The exceptions are deliberate:
 *
 *  - a *locked* account says so, with the minutes remaining, because the user
 *    is by then almost always the legitimate owner who has mistyped five times
 *    and needs to know that waiting will fix it;
 *  - an ambiguous email says which companies it matches, because that is not a
 *    secret to somebody who already knows the address, and the alternative is
 *    a login that fails with no way to succeed.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private readonly maxFailedLogins = envInt('AUTH_MAX_FAILED_LOGINS', 5);
  private readonly lockoutMinutes = envInt('AUTH_LOCKOUT_MINUTES', 15);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly authCache: AuthCacheService,
    private readonly permissions: PermissionResolverService,
    private readonly audit: AuditService,
    private readonly push: PushService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Web user sign-in
  // ─────────────────────────────────────────────────────────────────────────

  async login(dto: LoginDto, origin: SessionOrigin) {
    // Unscoped: there is no authenticated tenant yet, and resolving the email
    // to a principal is exactly the step that determines one.
    const candidates = await this.authCache.runUnscoped(() =>
      this.prisma.user.findMany({
        where: {
          email: dto.email,
          deletedAt: null,
          ...(dto.tenantCode ? { tenant: { code: dto.tenantCode } } : {}),
        },
        select: {
          id: true,
          tenantId: true,
          email: true,
          fullName: true,
          passwordHash: true,
          status: true,
          failedLogins: true,
          lockedUntil: true,
          isSuperAdmin: true,
          locale: true,
          roleId: true,
          role: {
            select: {
              code: true,
              rank: true,
              nameAr: true,
              nameEn: true,
              permissions: { select: { permissionCode: true } },
            },
          },
          permissionOverrides: {
            select: { permissionCode: true, granted: true },
          },
          tenant: {
            select: {
              id: true,
              code: true,
              nameAr: true,
              nameEn: true,
              status: true,
              subscriptionEnd: true,
              logoUrl: true,
              defaultLocale: true,
              featureFlags: true,
            },
          },
        },
      }),
    );

    if (candidates.length > 1) {
      // Same address at two companies. Ask which, rather than picking one.
      throw new ConflictException({
        message:
          'هذا البريد مسجل في أكثر من شركة، يرجى تحديد كود الشركة - ' +
          'This email exists in more than one company; please provide the company code',
        errorCode: 'TENANT_REQUIRED',
        tenants: candidates.map((c) => ({
          code: c.tenant.code,
          nameAr: c.tenant.nameAr,
          nameEn: c.tenant.nameEn,
        })),
      });
    }

    const user = candidates[0];

    // Run the comparison even with no user, so a missing account takes the
    // same time as a wrong password.
    const passwordOk = await this.passwords.verify(
      dto.password,
      user?.passwordHash,
    );

    if (!user) throw this.invalidCredentials();

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60_000,
      );
      throw new ForbiddenException({
        message:
          `تم قفل الحساب مؤقتًا، حاول بعد ${minutes} دقيقة - ` +
          `Account is temporarily locked; try again in ${minutes} minute(s)`,
        errorCode: 'ACCOUNT_LOCKED',
      });
    }

    if (!passwordOk) {
      await this.recordFailedLogin(user.id, user.failedLogins);
      await this.audit.log({
        tenantId: user.tenantId,
        action: 'AUTH_LOGIN_FAILED',
        category: 'AUTH',
        severity: 'WARNING',
        actorType: PrincipalType.WEB_USER,
        actorId: user.id,
        actorName: user.fullName,
        entityType: 'User',
        entityId: user.id,
        ip: origin.ip,
        userAgent: origin.userAgent,
      });
      throw this.invalidCredentials();
    }

    // Status and tenant are checked only after the password is verified, so a
    // wrong password on a disabled account is indistinguishable from a wrong
    // password on a live one.
    if (user.status !== 'ACTIVE') {
      throw this.invalidCredentials();
    }
    this.assertTenantUsable(user.tenant, user.isSuperAdmin);

    const tokens = await this.tokens.issue(
      {
        id: user.id,
        tenantId: user.tenantId,
        principalType: PrincipalType.WEB_USER,
      },
      { ...origin, device: dto.device },
    );

    await this.authCache.runUnscoped(() =>
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          lastLoginIp: origin.ip,
          failedLogins: 0,
          lockedUntil: null,
        },
      }),
    );
    await this.authCache.invalidatePrincipal(user.id);

    await this.audit.log({
      tenantId: user.tenantId,
      action: 'AUTH_LOGIN',
      category: 'AUTH',
      actorType: PrincipalType.WEB_USER,
      actorId: user.id,
      actorName: user.fullName,
      entityType: 'User',
      entityId: user.id,
      ip: origin.ip,
      userAgent: origin.userAgent,
    });

    return {
      ...this.tokenResponse(tokens),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        locale: user.locale,
        isSuperAdmin: user.isSuperAdmin,
        role: user.role
          ? {
              id: user.roleId,
              code: user.role.code,
              nameAr: user.role.nameAr,
              nameEn: user.role.nameEn,
              rank: user.role.rank,
            }
          : null,
        permissions: this.permissions.applyTenantFlags(
          this.permissions.resolve(user),
          user.tenant.featureFlags as Record<string, unknown>,
        ),
        tenant: {
          id: user.tenant.id,
          code: user.tenant.code,
          nameAr: user.tenant.nameAr,
          nameEn: user.tenant.nameEn,
          logoUrl: user.tenant.logoUrl,
          defaultLocale: user.tenant.defaultLocale,
          featureFlags: user.tenant.featureFlags,
        },
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Field investigator sign-in — the future mobile application's entry point
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Investigators sign in with an employee code or phone plus a company code,
   * not an email: many have no work email, and a phone number is the one
   * identifier every field employee reliably has and remembers.
   */
  async investigatorLogin(dto: InvestigatorLoginDto, origin: SessionOrigin) {
    const investigator = await this.authCache.runUnscoped(() =>
      this.prisma.investigator.findFirst({
        where: {
          tenant: { code: dto.tenantCode },
          deletedAt: null,
          OR: [{ employeeCode: dto.identifier }, { phone: dto.identifier }],
        },
        select: {
          id: true,
          tenantId: true,
          employeeCode: true,
          fullName: true,
          phone: true,
          avatarUrl: true,
          passwordHash: true,
          status: true,
          locale: true,
          governorateIds: true,
          investigationTypeIds: true,
          productIds: true,
          maxDailyCases: true,
          maxOpenCases: true,
          tenant: {
            select: {
              id: true,
              code: true,
              nameAr: true,
              nameEn: true,
              status: true,
              subscriptionEnd: true,
              logoUrl: true,
            },
          },
        },
      }),
    );

    const passwordOk = await this.passwords.verify(
      dto.password,
      investigator?.passwordHash,
    );

    if (!investigator || !passwordOk) throw this.invalidCredentials();

    if (
      investigator.status === 'SUSPENDED' ||
      investigator.status === 'INACTIVE'
    ) {
      throw this.invalidCredentials();
    }
    this.assertTenantUsable(investigator.tenant, false);

    const tokens = await this.tokens.issue(
      {
        id: investigator.id,
        tenantId: investigator.tenantId,
        principalType: PrincipalType.INVESTIGATOR,
      },
      { ...origin, device: dto.deviceModel ?? dto.deviceId },
    );

    // Device details are recorded on sign-in so the platform can reach this
    // handset with a push notification later, and so an administrator can see
    // which device holds a session.
    await this.authCache.runUnscoped(() =>
      this.prisma.investigator.update({
        where: { id: investigator.id },
        data: {
          lastActivityAt: new Date(),
          deviceId: dto.deviceId ?? undefined,
          deviceModel: dto.deviceModel ?? undefined,
          devicePlatform: dto.devicePlatform ?? undefined,
          pushToken: dto.pushToken ?? undefined,
        },
      }),
    );
    await this.authCache.invalidatePrincipal(investigator.id);

    await this.audit.log({
      tenantId: investigator.tenantId,
      action: 'AUTH_LOGIN',
      category: 'AUTH',
      actorType: PrincipalType.INVESTIGATOR,
      actorId: investigator.id,
      actorName: investigator.fullName,
      entityType: 'Investigator',
      entityId: investigator.id,
      ip: origin.ip,
      userAgent: origin.userAgent,
      metadata: { devicePlatform: dto.devicePlatform },
    });

    return {
      ...this.tokenResponse(tokens),
      investigator: {
        id: investigator.id,
        employeeCode: investigator.employeeCode,
        fullName: investigator.fullName,
        phone: investigator.phone,
        avatarUrl: investigator.avatarUrl,
        status: investigator.status,
        locale: investigator.locale,
        governorateIds: investigator.governorateIds,
        investigationTypeIds: investigator.investigationTypeIds,
        productIds: investigator.productIds,
        maxDailyCases: investigator.maxDailyCases,
        maxOpenCases: investigator.maxOpenCases,
        tenant: {
          id: investigator.tenant.id,
          code: investigator.tenant.code,
          nameAr: investigator.tenant.nameAr,
          nameEn: investigator.tenant.nameEn,
          logoUrl: investigator.tenant.logoUrl,
        },
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Session lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async refresh(refreshToken: string, origin: SessionOrigin) {
    const tokens = await this.tokens.rotate(refreshToken, origin);
    return this.tokenResponse(tokens);
  }

  /**
   * End this session only. Other devices keep working, which is what "log out"
   * means on a shared machine.
   */
  async logout(principal: {
    id: string;
    tenantId: string;
    sessionId?: string;
    jti?: string;
    fullName: string;
    principalType: PrincipalType;
  }) {
    if (principal.sessionId) {
      await this.tokens.endSession(
        principal.sessionId,
        principal.jti,
        undefined,
      );
    }
    await this.authCache.invalidatePrincipal(principal.id);

    await this.audit.log({
      tenantId: principal.tenantId,
      action: 'AUTH_LOGOUT',
      category: 'AUTH',
      actorType: principal.principalType,
      actorId: principal.id,
      actorName: principal.fullName,
    });

    return { success: true, message: 'تم تسجيل الخروج - Logged out' };
  }

  /** End every session this principal holds, on every device. */
  async logoutAll(principal: {
    id: string;
    tenantId: string;
    fullName: string;
    principalType: PrincipalType;
  }) {
    const count = await this.authCache.revokePrincipalSessions(
      principal.id,
      'user logged out of all devices',
    );

    // This is the button somebody presses when a phone is lost. Ending the
    // sessions without disabling the push registrations would leave case
    // numbers arriving on the lock screen of a handset in somebody else's
    // hand — push does not need a session, which is the point of it.
    //
    // `disableForPrincipal` swallows its own failures: signing out of every
    // device must succeed even if this does not.
    const devices = await this.push.disableForPrincipal(
      principal.id,
      principal.principalType,
      'user logged out of all devices',
    );

    await this.audit.log({
      tenantId: principal.tenantId,
      action: 'AUTH_LOGOUT_ALL',
      category: 'AUTH',
      severity: 'NOTICE',
      actorType: principal.principalType,
      actorId: principal.id,
      actorName: principal.fullName,
      metadata: { sessionsEnded: count, devicesDisabled: devices },
    });

    return {
      success: true,
      sessionsEnded: count,
      devicesDisabled: devices,
      message: `تم إنهاء ${count} جلسة - Ended ${count} session(s)`,
    };
  }

  /** The sessions a principal is currently holding, for the profile screen. */
  async listSessions(principalId: string, tenantId: string) {
    return this.prisma.session.findMany({
      where: {
        tenantId,
        OR: [{ userId: principalId }, { investigatorId: principalId }],
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        ip: true,
        userAgent: true,
        device: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Password change
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Changing a password ends every *other* session.
   *
   * The usual reason somebody changes a password is that they think it is
   * compromised, so leaving the other sessions alive would defeat the act. The
   * current session survives, because signing the user out of the screen they
   * just used feels like a failure.
   */
  async changePassword(
    principal: {
      id: string;
      tenantId: string;
      fullName: string;
      principalType: PrincipalType;
      sessionId?: string;
    },
    dto: ChangePasswordDto,
  ) {
    const isInvestigator =
      principal.principalType === PrincipalType.INVESTIGATOR;

    const current = isInvestigator
      ? await this.prisma.investigator.findFirst({
          where: { id: principal.id, tenantId: principal.tenantId },
          select: { passwordHash: true },
        })
      : await this.prisma.user.findFirst({
          where: { id: principal.id, tenantId: principal.tenantId },
          select: { passwordHash: true },
        });

    if (!current) throw new UnauthorizedException();

    const ok = await this.passwords.verify(
      dto.currentPassword,
      current.passwordHash,
    );
    if (!ok) {
      throw new UnauthorizedException(
        'كلمة المرور الحالية غير صحيحة - Current password is incorrect',
      );
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);

    if (isInvestigator) {
      await this.prisma.investigator.update({
        where: { id: principal.id },
        data: { passwordHash },
      });
    } else {
      await this.prisma.user.update({
        where: { id: principal.id },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
    }

    await this.prisma.session.updateMany({
      where: {
        tenantId: principal.tenantId,
        OR: [{ userId: principal.id }, { investigatorId: principal.id }],
        revokedAt: null,
        ...(principal.sessionId ? { NOT: { id: principal.sessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: 'password changed' },
    });

    await this.authCache.invalidatePrincipal(principal.id);

    await this.audit.log({
      tenantId: principal.tenantId,
      action: 'AUTH_PASSWORD_CHANGED',
      category: 'AUTH',
      severity: 'NOTICE',
      actorType: principal.principalType,
      actorId: principal.id,
      actorName: principal.fullName,
    });

    return {
      success: true,
      message:
        'تم تغيير كلمة المرور وإنهاء الجلسات الأخرى - ' +
        'Password changed; other sessions were ended',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Internals
  // ─────────────────────────────────────────────────────────────────────────

  private tokenResponse(tokens: IssuedTokens) {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: 'Bearer' as const,
      expiresIn: tokens.expiresIn,
    };
  }

  /** One message for every kind of failure. See the note at the top. */
  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      message: 'بيانات الدخول غير صحيحة - Invalid credentials',
      errorCode: 'INVALID_CREDENTIALS',
    });
  }

  /**
   * Count a failure and lock the account once the threshold is crossed.
   *
   * A fixed window rather than escalating backoff: the population is staff who
   * mistype, not a botnet, and an operations room locked out for an
   * ever-doubling period during a shift is a worse outcome than the marginal
   * hardening.
   */
  private async recordFailedLogin(
    userId: string,
    currentFailures: number,
  ): Promise<void> {
    const failures = currentFailures + 1;
    const shouldLock = failures >= this.maxFailedLogins;

    await this.authCache
      .runUnscoped(() =>
        this.prisma.user.update({
          where: { id: userId },
          data: {
            failedLogins: shouldLock ? 0 : failures,
            lockedUntil: shouldLock
              ? new Date(Date.now() + this.lockoutMinutes * 60_000)
              : null,
          },
        }),
      )
      .catch((error) =>
        this.logger.warn(`Could not record failed login: ${String(error)}`),
      );
  }

  private assertTenantUsable(
    tenant: { status: TenantStatus; subscriptionEnd: Date | null },
    isSuperAdmin: boolean,
  ): void {
    if (isSuperAdmin) return;

    if (tenant.status === TenantStatus.SUSPENDED) {
      throw new ForbiddenException(
        'تم إيقاف حساب الشركة - Company account is suspended',
      );
    }
    if (
      tenant.status === TenantStatus.EXPIRED ||
      (tenant.subscriptionEnd && tenant.subscriptionEnd.getTime() <= Date.now())
    ) {
      throw new ForbiddenException(
        'انتهى اشتراك الشركة - Company subscription has expired',
      );
    }
  }
}
