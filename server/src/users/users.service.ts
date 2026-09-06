import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { AuthCacheService } from '../auth/auth-cache.service';
import { paginate } from '../common/interfaces/api.interface';
import { isKnownPermission } from '../common/constants/permissions';
import {
  CreateUserDto,
  SetUserPermissionsDto,
  UpdateUserDto,
  UserQueryDto,
} from './dto/user.dto';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';

const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  employeeCode: true,
  avatarUrl: true,
  status: true,
  locale: true,
  branch: true,
  department: true,
  allowedGovernorateIds: true,
  isSuperAdmin: true,
  mfaEnabled: true,
  lastLoginAt: true,
  lastLoginIp: true,
  lockedUntil: true,
  failedLogins: true,
  createdAt: true,
  updatedAt: true,
  roleId: true,
  role: {
    select: { id: true, code: true, nameAr: true, nameEn: true, rank: true },
  },
} satisfies Prisma.UserSelect;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Web user management.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  WEB USERS ARE NOT FIELD INVESTIGATORS. They are different tables, different
 *  lifecycles, different login endpoints and different screens. This module
 *  never touches `Investigator`, and `InvestigatorsService` never touches
 *  `User`.
 *
 *  RANK DECIDES WHO MAY ACT ON WHOM. A user may only edit, disable, delete,
 *  re-role or end the sessions of somebody whose role ranks strictly below
 *  theirs. Equal rank does not grant control, which has two useful
 *  consequences: one admin cannot disable a peer admin, and nobody can act on
 *  themselves through these endpoints — the profile screen is the place for
 *  that, and it cannot change a role.
 *
 *  A password is never returned, never logged, and never chosen by an
 *  administrator: `create` generates one and returns it exactly once.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly authCache: AuthCacheService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Control checks
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Load a target user and confirm the actor outranks them.
   *
   * A super admin outranks everybody. Otherwise the comparison is on role rank,
   * and a user with no role ranks 0 — so anybody with a role can act on an
   * unassigned account, which is the sensible reading of a half-created user.
   */
  private async loadControllable(
    tenantId: string,
    actor: AuthenticatedUser,
    targetId: string,
  ) {
    const target = await this.prisma.user.findFirst({
      where: { tenantId, id: targetId, deletedAt: null },
      select: { ...USER_SELECT, passwordHash: false },
    });

    if (!target) {
      throw new NotFoundException('المستخدم غير موجود - User not found');
    }

    if (actor.isSuperAdmin) return target;

    if (target.isSuperAdmin) {
      throw new ForbiddenException(
        'لا يمكن تعديل حساب مشغل المنصة - A platform operator account cannot be modified here',
      );
    }

    if (target.id === actor.id) {
      throw new ForbiddenException(
        'لا يمكنك تنفيذ هذا الإجراء على حسابك، استخدم صفحة الملف الشخصي - ' +
          'You cannot perform this action on your own account; use your profile page',
      );
    }

    const targetRank = target.role?.rank ?? 0;
    if (actor.roleRank <= targetRank) {
      throw new ForbiddenException(
        'لا يمكنك تعديل مستخدم بنفس صلاحيتك أو أعلى - ' +
          'You cannot act on a user at or above your own level',
      );
    }

    return target;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Read
  // ─────────────────────────────────────────────────────────────────────────

  async findAll(tenantId: string, query: UserQueryDto) {
    const where: Prisma.UserWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.roleId ? { roleId: query.roleId } : {}),
      ...(query.department ? { department: query.department } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { employeeCode: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: query.orderBy(
          ['fullName', 'email', 'createdAt', 'lastLoginAt', 'status'],
          'fullName',
        ),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.limit);
  }

  async findOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: {
        ...USER_SELECT,
        permissionOverrides: {
          select: { permissionCode: true, granted: true },
        },
        role: {
          select: {
            id: true,
            code: true,
            nameAr: true,
            nameEn: true,
            rank: true,
            permissions: { select: { permissionCode: true } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود - User not found');
    }

    return user;
  }

  /** Login activity and live sessions — the account's security tab. */
  async activity(tenantId: string, id: string) {
    const [user, sessions, recentAuth] = await Promise.all([
      this.prisma.user.findFirst({
        where: { tenantId, id, deletedAt: null },
        select: {
          lastLoginAt: true,
          lastLoginIp: true,
          failedLogins: true,
          lockedUntil: true,
          passwordChangedAt: true,
        },
      }),
      this.prisma.session.findMany({
        where: {
          tenantId,
          userId: id,
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
      }),
      this.prisma.auditLog.findMany({
        where: { tenantId, userId: id, category: 'AUTH' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          action: true,
          ip: true,
          userAgent: true,
          createdAt: true,
        },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود - User not found');
    }

    return { ...user, activeSessions: sessions, recentAuthEvents: recentAuth };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Write
  // ─────────────────────────────────────────────────────────────────────────

  async create(tenantId: string, actor: AuthenticatedUser, dto: CreateUserDto) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { maxWebUsers: true },
    });

    const currentCount = await this.prisma.user.count({
      where: { tenantId, deletedAt: null },
    });

    if (currentCount >= tenant.maxWebUsers) {
      throw new BadRequestException(
        `تم الوصول للحد الأقصى من المستخدمين (${tenant.maxWebUsers}) - ` +
          `The user limit for this plan (${tenant.maxWebUsers}) has been reached`,
      );
    }

    const clash = await this.prisma.user.findFirst({
      where: { tenantId, email: dto.email },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        'البريد الإلكتروني مستخدم بالفعل - This email is already in use',
      );
    }

    const role = await this.assertAssignableRole(tenantId, actor, dto.roleId);

    // Generated, not chosen: an administrator inventing a password means a
    // predictable one, and it means the plaintext exists in whatever they typed
    // it into.
    const password = this.passwords.generate();
    const passwordHash = await this.passwords.hash(password);

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email,
        fullName: dto.fullName,
        phone: dto.phone,
        employeeCode: dto.employeeCode,
        locale: dto.locale ?? 'ar',
        branch: dto.branch,
        department: dto.department,
        allowedGovernorateIds: dto.allowedGovernorateIds ?? [],
        roleId: role?.id,
        passwordHash,
        status: UserStatus.ACTIVE,
        createdById: actor.id,
      },
      select: USER_SELECT,
    });

    await this.audit.log({
      tenantId,
      action: 'USER_CREATED',
      category: 'USER',
      severity: 'NOTICE',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.email,
      newValue: {
        email: user.email,
        fullName: user.fullName,
        roleCode: role?.code,
      },
    });

    // Returned once and never stored in plaintext anywhere. The UI shows it in
    // a copy-once dialog.
    return { user, temporaryPassword: password };
  }

  async update(
    tenantId: string,
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateUserDto,
  ) {
    const target = await this.loadControllable(tenantId, actor, id);

    if (dto.email && dto.email !== target.email) {
      const clash = await this.prisma.user.findFirst({
        where: { tenantId, email: dto.email, NOT: { id } },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          'البريد الإلكتروني مستخدم بالفعل - This email is already in use',
        );
      }
    }

    if (dto.roleId !== undefined) {
      await this.assertAssignableRole(tenantId, actor, dto.roleId);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: dto,
      select: USER_SELECT,
    });

    // Role, geography and status all change what the cached principal contains,
    // so the cache has to go or the change takes up to 30 seconds to bite.
    await this.authCache.invalidatePrincipal(id);

    const { oldValue, newValue } = this.audit.diff(
      target,
      dto as Record<string, unknown>,
    );

    await this.audit.log({
      tenantId,
      action: 'USER_UPDATED',
      category: 'USER',
      severity: dto.roleId !== undefined ? 'NOTICE' : 'INFO',
      entityType: 'User',
      entityId: id,
      entityLabel: target.email,
      oldValue,
      newValue,
    });

    return updated;
  }

  /**
   * Enable or disable.
   *
   * Disabling revokes every session, not just the cache: a disabled user with a
   * live access token would otherwise keep working until it expired, and
   * "disable this account now" is usually said in a hurry for a reason.
   */
  async setStatus(
    tenantId: string,
    actor: AuthenticatedUser,
    id: string,
    status: UserStatus,
    reason?: string,
  ) {
    const target = await this.loadControllable(tenantId, actor, id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        status,
        ...(status === UserStatus.ACTIVE
          ? { failedLogins: 0, lockedUntil: null }
          : {}),
      },
      select: USER_SELECT,
    });

    if (status !== UserStatus.ACTIVE) {
      await this.authCache.revokePrincipalSessions(
        id,
        reason ?? `status changed to ${status}`,
      );
    } else {
      await this.authCache.invalidatePrincipal(id);
    }

    await this.audit.log({
      tenantId,
      action: status === UserStatus.ACTIVE ? 'USER_ENABLED' : 'USER_DISABLED',
      category: 'USER',
      severity: 'WARNING',
      entityType: 'User',
      entityId: id,
      entityLabel: target.email,
      oldValue: { status: target.status },
      newValue: { status },
      metadata: reason ? { reason } : undefined,
    });

    return updated;
  }

  /** Clear a lockout without changing the password. */
  async unlock(tenantId: string, actor: AuthenticatedUser, id: string) {
    const target = await this.loadControllable(tenantId, actor, id);

    await this.prisma.user.update({
      where: { id },
      data: { failedLogins: 0, lockedUntil: null },
    });
    await this.authCache.invalidatePrincipal(id);

    await this.audit.log({
      tenantId,
      action: 'USER_UNLOCKED',
      category: 'SECURITY',
      severity: 'NOTICE',
      entityType: 'User',
      entityId: id,
      entityLabel: target.email,
    });

    return { success: true };
  }

  /**
   * Reset a password to a new generated one and end every session.
   *
   * The sessions have to go: the usual reason for a reset is that the old
   * credential is compromised, and leaving the attacker's session alive defeats
   * the whole act.
   */
  async resetPassword(tenantId: string, actor: AuthenticatedUser, id: string) {
    const target = await this.loadControllable(tenantId, actor, id);

    const password = this.passwords.generate();
    const passwordHash = await this.passwords.hash(password);

    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLogins: 0,
        lockedUntil: null,
      },
    });

    await this.authCache.revokePrincipalSessions(id, 'password reset by admin');

    await this.audit.log({
      tenantId,
      action: 'USER_PASSWORD_RESET',
      category: 'SECURITY',
      severity: 'WARNING',
      entityType: 'User',
      entityId: id,
      entityLabel: target.email,
    });

    return { temporaryPassword: password };
  }

  /** End every session a user holds, without changing anything else. */
  async revokeSessions(tenantId: string, actor: AuthenticatedUser, id: string) {
    const target = await this.loadControllable(tenantId, actor, id);

    const count = await this.authCache.revokePrincipalSessions(
      id,
      'sessions revoked by administrator',
    );

    await this.audit.log({
      tenantId,
      action: 'USER_SESSIONS_REVOKED',
      category: 'SECURITY',
      severity: 'NOTICE',
      entityType: 'User',
      entityId: id,
      entityLabel: target.email,
      metadata: { sessionsEnded: count },
    });

    return { sessionsEnded: count };
  }

  /**
   * Per-user permission grants and denies, on top of the role.
   *
   * Codes are validated against the catalogue: storing one this build does not
   * understand would put a row in the database that no guard will ever check,
   * and it would look on screen like the permission had been granted.
   */
  async setPermissions(
    tenantId: string,
    actor: AuthenticatedUser,
    id: string,
    dto: SetUserPermissionsDto,
  ) {
    const target = await this.loadControllable(tenantId, actor, id);

    const unknown = dto.overrides
      .map((o) => o.permissionCode)
      .filter((code) => !isKnownPermission(code));

    if (unknown.length > 0) {
      throw new BadRequestException(
        `صلاحيات غير معروفة: ${unknown.join(', ')} - Unknown permissions: ${unknown.join(', ')}`,
      );
    }

    // An actor cannot grant what they do not themselves hold. Without this,
    // a coordinator with `permissions.assign` could grant themselves — via a
    // colleague, then a swap — everything in the catalogue.
    if (!actor.isSuperAdmin) {
      const escalation = dto.overrides
        .filter(
          (o) => o.granted && !actor.permissions.includes(o.permissionCode),
        )
        .map((o) => o.permissionCode);

      if (escalation.length > 0) {
        throw new ForbiddenException(
          `لا يمكنك منح صلاحيات لا تملكها: ${escalation.join(', ')} - ` +
            `You cannot grant permissions you do not hold: ${escalation.join(', ')}`,
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.userPermissionOverride.deleteMany({ where: { userId: id } }),
      this.prisma.userPermissionOverride.createMany({
        data: dto.overrides.map((o) => ({
          userId: id,
          permissionCode: o.permissionCode,
          granted: o.granted,
        })),
      }),
    ]);

    await this.authCache.invalidatePrincipal(id);

    await this.audit.log({
      tenantId,
      action: 'PERMISSION_CHANGED',
      category: 'ROLE',
      severity: 'WARNING',
      entityType: 'User',
      entityId: id,
      entityLabel: target.email,
      newValue: {
        granted: dto.overrides
          .filter((o) => o.granted)
          .map((o) => o.permissionCode),
        denied: dto.overrides
          .filter((o) => !o.granted)
          .map((o) => o.permissionCode),
      },
    });

    return this.findOne(tenantId, id);
  }

  /**
   * Soft delete, and end every session.
   *
   * Soft because audit rows, assignments and case history all name this user;
   * a hard delete would leave "assigned by ????" across years of records.
   */
  async remove(tenantId: string, actor: AuthenticatedUser, id: string) {
    const target = await this.loadControllable(tenantId, actor, id);

    await this.prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: UserStatus.DISABLED,
        // Freed so the address can be reused, while the row stays for history.
        email: `${target.email}.deleted.${Date.now()}`,
      },
    });

    await this.authCache.revokePrincipalSessions(id, 'account deleted');

    await this.audit.log({
      tenantId,
      action: 'USER_DELETED',
      category: 'USER',
      severity: 'CRITICAL',
      entityType: 'User',
      entityId: id,
      entityLabel: target.email,
    });

    return { success: true };
  }

  /** A role must exist in this tenant, and the actor must outrank it. */
  private async assertAssignableRole(
    tenantId: string,
    actor: AuthenticatedUser,
    roleId?: string | null,
  ) {
    if (!roleId) return null;

    const role = await this.prisma.role.findFirst({
      where: { tenantId, id: roleId },
      select: { id: true, code: true, rank: true },
    });

    if (!role) {
      throw new BadRequestException('الدور غير موجود - Role not found');
    }

    // Otherwise a supervisor could create a company admin and log in as them.
    if (!actor.isSuperAdmin && role.rank >= actor.roleRank) {
      throw new ForbiddenException(
        'لا يمكنك إسناد دور بنفس صلاحيتك أو أعلى - ' +
          'You cannot assign a role at or above your own level',
      );
    }

    return role;
  }
}
