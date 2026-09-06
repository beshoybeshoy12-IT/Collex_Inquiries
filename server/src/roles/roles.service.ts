import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthCacheService } from '../auth/auth-cache.service';
import {
  ALL_PERMISSION_CODES,
  isKnownPermission,
  PERMISSION_CATALOG,
} from '../common/constants/permissions';
import { SYSTEM_ROLES, permissionsFor } from '../common/constants/system-roles';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';

/**
 * Roles are per-tenant bundles of permissions.
 *
 * The seeded ones are marked `isSystem`. That protects their `code` and stops
 * them being deleted — the seeder and the documentation refer to them by code —
 * but NOT their grants. A tenant whose supervisors should also approve QC edits
 * the supervisor role; requiring them to clone it first would mean every tenant
 * ends up with "Supervisor (copy)" and the original left dangling.
 *
 * PRIVILEGE ESCALATION IS THE THING THIS FILE GUARDS AGAINST. Two rules do it:
 * a user may not create or edit a role ranked at or above their own, and may
 * not grant a permission they do not themselves hold. Without the second, a
 * coordinator with `roles.edit` writes themselves a role with `tenant.manage`
 * and the RBAC model is decorative.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authCache: AuthCacheService,
  ) {}

  /** The permission catalogue, for the matrix UI. */
  catalog() {
    return {
      permissions: PERMISSION_CATALOG,
      categories: [...new Set(PERMISSION_CATALOG.map((p) => p.category))],
    };
  }

  async findAll(tenantId: string) {
    return this.prisma.role.findMany({
      where: { tenantId },
      include: {
        permissions: { select: { permissionCode: true } },
        _count: { select: { users: true } },
      },
      orderBy: [{ rank: 'desc' }, { nameEn: 'asc' }],
    });
  }

  async findOne(tenantId: string, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { tenantId, id },
      include: {
        permissions: { select: { permissionCode: true } },
        _count: { select: { users: true } },
      },
    });
    if (!role) {
      throw new NotFoundException('الدور غير موجود - Role not found');
    }
    return role;
  }

  async create(tenantId: string, actor: AuthenticatedUser, dto: CreateRoleDto) {
    this.assertRankAllowed(actor, dto.rank);
    this.assertPermissionsAllowed(actor, dto.permissions);

    const clash = await this.prisma.role.findFirst({
      where: { tenantId, code: dto.code },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        'كود الدور مستخدم بالفعل - Role code is already in use',
      );
    }

    const role = await this.prisma.role.create({
      data: {
        tenantId,
        code: dto.code,
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        description: dto.description,
        rank: dto.rank,
        isSystem: false,
        permissions: {
          create: dto.permissions.map((permissionCode) => ({ permissionCode })),
        },
      },
      include: { permissions: { select: { permissionCode: true } } },
    });

    await this.audit.log({
      tenantId,
      action: 'ROLE_CREATED',
      category: 'ROLE',
      severity: 'NOTICE',
      entityType: 'Role',
      entityId: role.id,
      entityLabel: role.code,
      newValue: {
        code: role.code,
        rank: role.rank,
        permissions: dto.permissions,
      },
    });

    return role;
  }

  async update(
    tenantId: string,
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateRoleDto,
  ) {
    const existing = await this.findOne(tenantId, id);

    // A user cannot edit a role at or above their own level — including their
    // own role, which would otherwise be the shortest path to every permission.
    this.assertRankAllowed(actor, existing.rank);
    if (dto.rank !== undefined) this.assertRankAllowed(actor, dto.rank);
    if (dto.permissions) this.assertPermissionsAllowed(actor, dto.permissions);

    if (existing.isSystem && dto.code && dto.code !== existing.code) {
      throw new BadRequestException(
        'لا يمكن تغيير كود دور النظام - A system role code cannot be changed',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.update({
        where: { id },
        data: {
          ...(dto.code && !existing.isSystem ? { code: dto.code } : {}),
          ...(dto.nameAr ? { nameAr: dto.nameAr } : {}),
          ...(dto.nameEn ? { nameEn: dto.nameEn } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.rank !== undefined ? { rank: dto.rank } : {}),
        },
      });

      if (dto.permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: dto.permissions.map((permissionCode) => ({
            roleId: id,
            permissionCode,
          })),
        });
      }

      return role;
    });

    // Everybody holding this role has a cached permission list that no longer
    // matches. None of those cache entries know they depend on this row, so the
    // holders are read and evicted explicitly.
    await this.authCache.invalidateRole(tenantId, id);

    await this.audit.log({
      tenantId,
      action: 'ROLE_UPDATED',
      category: 'ROLE',
      severity: 'WARNING',
      entityType: 'Role',
      entityId: id,
      entityLabel: existing.code,
      oldValue: {
        rank: existing.rank,
        permissions: existing.permissions.map((p) => p.permissionCode),
      },
      newValue: {
        rank: dto.rank ?? existing.rank,
        permissions: dto.permissions,
      },
    });

    return this.findOne(tenantId, id);
  }

  /**
   * Delete a role nobody holds.
   *
   * Reassigning the holders automatically would be worse than refusing: the
   * only safe destination is a role somebody has chosen, and choosing it for
   * them silently changes what those users can do.
   */
  async remove(tenantId: string, actor: AuthenticatedUser, id: string) {
    const role = await this.findOne(tenantId, id);

    this.assertRankAllowed(actor, role.rank);

    if (role.isSystem) {
      throw new BadRequestException(
        'لا يمكن حذف أدوار النظام - A system role cannot be deleted',
      );
    }

    if (role._count.users > 0) {
      throw new BadRequestException(
        `الدور مستخدم بواسطة ${role._count.users} مستخدم، انقلهم أولًا - ` +
          `${role._count.users} user(s) hold this role; move them first`,
      );
    }

    await this.prisma.role.delete({ where: { id } });

    await this.audit.log({
      tenantId,
      action: 'ROLE_DELETED',
      category: 'ROLE',
      severity: 'WARNING',
      entityType: 'Role',
      entityId: id,
      entityLabel: role.code,
    });

    return { success: true };
  }

  /**
   * Create the default roles for a tenant.
   *
   * Idempotent — an existing role is left exactly as it is, including its
   * grants, so re-running the seeder against a live tenant cannot undo an
   * administrator's customisation.
   */
  async seedSystemRoles(tenantId: string): Promise<{ created: string[] }> {
    const existing = await this.prisma.role.findMany({
      where: { tenantId },
      select: { code: true },
    });
    const have = new Set(existing.map((r) => r.code));
    const created: string[] = [];

    for (const definition of SYSTEM_ROLES) {
      if (have.has(definition.code)) continue;

      await this.prisma.role.create({
        data: {
          tenantId,
          code: definition.code,
          nameAr: definition.nameAr,
          nameEn: definition.nameEn,
          description: definition.description,
          rank: definition.rank,
          isSystem: true,
          permissions: {
            create: permissionsFor(definition).map((permissionCode) => ({
              permissionCode,
            })),
          },
        },
      });
      created.push(definition.code);
    }

    return { created };
  }

  private assertRankAllowed(actor: AuthenticatedUser, rank: number): void {
    if (actor.isSuperAdmin) return;
    if (rank >= actor.roleRank) {
      throw new ForbiddenException(
        'لا يمكنك إنشاء أو تعديل دور بنفس مستواك أو أعلى - ' +
          'You cannot create or edit a role at or above your own level',
      );
    }
  }

  private assertPermissionsAllowed(
    actor: AuthenticatedUser,
    permissions: string[],
  ): void {
    const unknown = permissions.filter((code) => !isKnownPermission(code));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `صلاحيات غير معروفة: ${unknown.join(', ')} - Unknown permissions: ${unknown.join(', ')}`,
      );
    }

    if (actor.isSuperAdmin) return;

    const held = new Set(actor.permissions);
    const escalation = permissions.filter((code) => !held.has(code));

    if (escalation.length > 0) {
      throw new ForbiddenException(
        `لا يمكنك منح صلاحيات لا تملكها: ${escalation.join(', ')} - ` +
          `You cannot grant permissions you do not hold: ${escalation.join(', ')}`,
      );
    }
  }

  /** Make sure the catalogue in the database matches this build. */
  async syncPermissionCatalog(): Promise<{ upserted: number }> {
    for (const permission of PERMISSION_CATALOG) {
      await this.prisma.permission.upsert({
        where: { code: permission.code },
        create: permission,
        update: {
          category: permission.category,
          labelAr: permission.labelAr,
          labelEn: permission.labelEn,
          sortOrder: permission.sortOrder,
        },
      });
    }

    // A permission removed from the catalogue is deleted, which cascades to
    // every role grant — otherwise a guard would keep checking a code nothing
    // in the code base defines any more.
    await this.prisma.permission.deleteMany({
      where: { code: { notIn: [...ALL_PERMISSION_CODES] } },
    });

    return { upserted: PERMISSION_CATALOG.length };
  }
}
