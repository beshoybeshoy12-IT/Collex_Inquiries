import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_PERMISSION_CODES } from '../common/constants/permissions';

/**
 * Turns a user's role and overrides into the flat list of permission codes the
 * guard checks against.
 *
 * The resolution order is the whole model, and it is short on purpose:
 *
 *   1. super admin        → every permission, full stop.
 *   2. role grants        → the bundle the user's role carries.
 *   3. user overrides     → per-user grants and denies, applied last.
 *
 * A DENY beats a grant. That is what makes it possible to say "coordinators
 * may export, except this one" without cloning the coordinator role — and the
 * ordering has to be this way round, or an override could never take anything
 * away, which is the case it exists for.
 *
 * Tenant feature flags are applied on top by `applyTenantFlags`, and they can
 * only subtract. A tenant that has not bought the QC module cannot have QC
 * permissions, however its roles are configured; but switching the flag on
 * grants nobody anything they were not already given.
 */
@Injectable()
export class PermissionResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve from already-loaded relations.
   *
   * Kept pure and synchronous so `JwtStrategy` can call it inside the one query
   * it already makes, rather than adding a second round trip per request.
   */
  resolve(user: {
    isSuperAdmin: boolean;
    role?: { permissions: { permissionCode: string }[] } | null;
    permissionOverrides?: { permissionCode: string; granted: boolean }[];
  }): string[] {
    if (user.isSuperAdmin) return [...ALL_PERMISSION_CODES];

    const effective = new Set<string>(
      user.role?.permissions.map((p) => p.permissionCode) ?? [],
    );

    for (const override of user.permissionOverrides ?? []) {
      if (override.granted) {
        effective.add(override.permissionCode);
      } else {
        effective.delete(override.permissionCode);
      }
    }

    return [...effective];
  }

  /**
   * Subtract anything the tenant's plan does not include.
   *
   * `featureFlags` is `{ qc: false, forms: true, ... }`. A flag that is absent
   * means "included" — a new feature must not switch itself off for every
   * existing tenant the moment it ships.
   */
  applyTenantFlags(
    permissions: string[],
    featureFlags: Record<string, unknown> | null | undefined,
  ): string[] {
    if (!featureFlags) return permissions;

    const disabled = new Set(
      Object.entries(featureFlags)
        .filter(([, enabled]) => enabled === false)
        .map(([feature]) => feature),
    );
    if (disabled.size === 0) return permissions;

    // Permission codes are `category.action`, and the flag names are the
    // categories — so the mapping needs no second table to stay in step.
    return permissions.filter(
      (code) => !disabled.has(code.split('.')[0] ?? ''),
    );
  }

  /** Load and resolve for one user. Used outside the request path. */
  async forUser(tenantId: string, userId: string): Promise<string[]> {
    const user = await this.prisma.user.findFirst({
      where: { tenantId, id: userId },
      select: {
        isSuperAdmin: true,
        role: { select: { permissions: { select: { permissionCode: true } } } },
        permissionOverrides: {
          select: { permissionCode: true, granted: true },
        },
        tenant: { select: { featureFlags: true } },
      },
    });
    if (!user) return [];

    return this.applyTenantFlags(
      this.resolve(user),
      user.tenant?.featureFlags as Record<string, unknown> | null,
    );
  }
}
