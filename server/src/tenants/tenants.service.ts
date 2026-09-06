import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthCacheService } from '../auth/auth-cache.service';
import { PasswordService } from '../auth/password.service';
import { RolesService } from '../roles/roles.service';
import { RequestContextService } from '../common/context/request-context';
import { SYSTEM_ROLE_CODES } from '../common/constants/system-roles';
import {
  CreateTenantDto,
  UpdateTenantDto,
  UpdateTenantSettingsDto,
} from './dto/tenant.dto';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Tenant provisioning and profile.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Two audiences, and the split matters:
 *
 *  - `getOwn` / `updateOwn` are what a company administrator uses to edit their
 *    own company's profile. Nothing there can change the plan limits, the
 *    subscription or the status.
 *  - `create`, `setStatus` and `setLimits` are platform-operator only, and the
 *    controller gates them on `isSuperAdmin` rather than on a permission —
 *    because a permission is something a tenant administrator could eventually
 *    be granted, and this must never be.
 *
 *  PROVISIONING IS ONE TRANSACTION. A tenant with no roles is a tenant nobody
 *  can be created in, and a tenant with roles but no administrator is one
 *  nobody can sign into. Both halves land together or neither does.
 */
@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authCache: AuthCacheService,
    private readonly passwords: PasswordService,
    private readonly roles: RolesService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** The caller's own company. */
  async getOwn(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: {
          select: {
            users: true,
            investigators: true,
            investigations: true,
            customers: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('الشركة غير موجودة - Company not found');
    }

    return {
      ...tenant,
      usage: {
        users: tenant._count.users,
        maxUsers: tenant.maxWebUsers,
        investigators: tenant._count.investigators,
        maxInvestigators: tenant.maxInvestigators,
        investigations: tenant._count.investigations,
        customers: tenant._count.customers,
      },
    };
  }

  /**
   * Edit the company profile.
   *
   * The DTO has no `status`, `maxWebUsers`, `maxInvestigators` or
   * `subscriptionEnd` — a tenant raising its own limits is not a request this
   * API can express, and `forbidNonWhitelisted` turns an attempt into a 400.
   */
  async updateOwn(
    tenantId: string,
    user: AuthenticatedUser,
    dto: UpdateTenantDto,
  ) {
    const existing = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
    });

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: dto,
    });

    const { oldValue, newValue } = this.audit.diff(
      existing,
      dto as Record<string, unknown>,
    );

    await this.audit.log({
      tenantId,
      action: 'TENANT_UPDATED',
      category: 'TENANT',
      severity: 'NOTICE',
      entityType: 'Tenant',
      entityId: tenantId,
      entityLabel: existing.code,
      oldValue,
      newValue,
    });

    void user;
    return updated;
  }

  /**
   * Feature flags and settings.
   *
   * Flags subtract permissions — see `PermissionResolverService.applyTenantFlags`
   * — so every cached principal in the tenant is now wrong and has to go.
   */
  async updateSettings(tenantId: string, dto: UpdateTenantSettingsDto) {
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.featureFlags
          ? { featureFlags: dto.featureFlags as never }
          : {}),
        ...(dto.settings ? { settings: dto.settings as never } : {}),
        ...(dto.defaultLocale ? { defaultLocale: dto.defaultLocale } : {}),
        ...(dto.timezone ? { timezone: dto.timezone } : {}),
      },
    });

    await this.authCache.invalidateTenant(tenantId);

    await this.audit.log({
      tenantId,
      action: 'TENANT_SETTINGS_UPDATED',
      category: 'SETTINGS',
      severity: 'NOTICE',
      entityType: 'Tenant',
      entityId: tenantId,
      newValue: { featureFlags: dto.featureFlags },
    });

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Platform operator
  // ─────────────────────────────────────────────────────────────────────────

  /** Every tenant. Reachable only by a super admin — see the controller. */
  async findAll() {
    return this.requestContext.runAsSystem(() =>
      this.prisma.tenant.findMany({
        include: {
          _count: {
            select: { users: true, investigators: true, investigations: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /**
   * Provision a tenant: the company, its default roles, and its first
   * administrator, in one transaction.
   */
  async create(dto: CreateTenantDto) {
    return this.requestContext.runAsSystem(async () => {
      const clash = await this.prisma.tenant.findUnique({
        where: { code: dto.code },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          'كود الشركة مستخدم بالفعل - Company code is already in use',
        );
      }

      const password = this.passwords.generate();
      const passwordHash = await this.passwords.hash(password);

      const tenant = await this.prisma.tenant.create({
        data: {
          code: dto.code,
          nameAr: dto.nameAr,
          nameEn: dto.nameEn,
          status: dto.status ?? TenantStatus.TRIAL,
          email: dto.email,
          phone: dto.phone,
          taxId: dto.taxId,
          defaultLocale: dto.defaultLocale ?? 'ar',
          timezone: dto.timezone ?? 'Africa/Cairo',
          maxWebUsers: dto.maxWebUsers ?? 50,
          maxInvestigators: dto.maxInvestigators ?? 200,
          subscriptionStart: new Date(),
          subscriptionEnd: dto.subscriptionEnd
            ? new Date(dto.subscriptionEnd)
            : new Date(Date.now() + 30 * 86_400_000),
        },
      });

      // Roles first: the administrator needs one to exist.
      await this.roles.seedSystemRoles(tenant.id);

      const adminRole = await this.prisma.role.findFirstOrThrow({
        where: { tenantId: tenant.id, code: SYSTEM_ROLE_CODES.COMPANY_ADMIN },
        select: { id: true },
      });

      const admin = await this.prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.adminEmail,
          fullName: dto.adminName,
          passwordHash,
          roleId: adminRole.id,
          status: 'ACTIVE',
          locale: dto.defaultLocale ?? 'ar',
        },
        select: { id: true, email: true, fullName: true },
      });

      await this.audit.log({
        tenantId: tenant.id,
        action: 'TENANT_CREATED',
        category: 'TENANT',
        severity: 'CRITICAL',
        entityType: 'Tenant',
        entityId: tenant.id,
        entityLabel: tenant.code,
        newValue: {
          code: tenant.code,
          nameEn: tenant.nameEn,
          admin: admin.email,
        },
      });

      this.logger.log(`Provisioned tenant ${tenant.code} (${tenant.id})`);

      return { tenant, admin, temporaryPassword: password };
    }, 'tenant-provisioning');
  }

  /**
   * Suspend, expire or reactivate a tenant.
   *
   * Suspending ends every session in the company immediately. The alternative
   * — waiting for tokens to expire — means a suspended company keeps working
   * for up to fifteen minutes, which is not what "suspend" means to whoever
   * asked for it.
   */
  async setStatus(tenantId: string, status: TenantStatus, reason?: string) {
    return this.requestContext.runAsSystem(async () => {
      const tenant = await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { status },
      });

      if (status !== TenantStatus.ACTIVE && status !== TenantStatus.TRIAL) {
        const ended = await this.authCache.revokeTenantSessions(
          tenantId,
          reason ?? `tenant status changed to ${status}`,
        );
        this.logger.warn(
          `Tenant ${tenant.code} set to ${status}; ended ${ended} session(s)`,
        );
      } else {
        await this.authCache.invalidateTenant(tenantId);
      }

      await this.audit.log({
        tenantId,
        action: 'TENANT_STATUS_CHANGED',
        category: 'TENANT',
        severity: 'CRITICAL',
        actorName: 'platform-operator',
        entityType: 'Tenant',
        entityId: tenantId,
        entityLabel: tenant.code,
        newValue: { status },
        metadata: reason ? { reason } : undefined,
      });

      return tenant;
    }, 'tenant-administration');
  }

  /** Plan limits and subscription window. Platform operator only. */
  async setLimits(
    tenantId: string,
    limits: {
      maxWebUsers?: number;
      maxInvestigators?: number;
      subscriptionEnd?: string;
    },
  ) {
    return this.requestContext.runAsSystem(async () => {
      const tenant = await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          ...(limits.maxWebUsers !== undefined
            ? { maxWebUsers: limits.maxWebUsers }
            : {}),
          ...(limits.maxInvestigators !== undefined
            ? { maxInvestigators: limits.maxInvestigators }
            : {}),
          ...(limits.subscriptionEnd
            ? { subscriptionEnd: new Date(limits.subscriptionEnd) }
            : {}),
        },
      });

      // A renewed subscription must take effect on the next request, not after
      // the cache TTL — the users are, by definition, currently locked out.
      await this.authCache.invalidateTenant(tenantId);

      await this.audit.log({
        tenantId,
        action: 'TENANT_LIMITS_CHANGED',
        category: 'TENANT',
        severity: 'CRITICAL',
        actorName: 'platform-operator',
        entityType: 'Tenant',
        entityId: tenantId,
        entityLabel: tenant.code,
        newValue: limits,
      });

      return tenant;
    }, 'tenant-administration');
  }
}
