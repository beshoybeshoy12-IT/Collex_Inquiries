import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../common/context/request-context';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The 30-second principal cache, and the two ways to undo it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Every authenticated request resolves the caller: their row, their role,
 *  their effective permissions. Doing that from Postgres on every request is
 *  three joins per call. Caching it for 30 seconds makes it one lookup per
 *  principal per half-minute, at the cost of a permission change taking up to
 *  30 seconds to bite.
 *
 *  ANY MUTATION THAT CHANGES WHAT THE CACHED OBJECT CONTAINS MUST EVICT IT.
 *  Forgetting is not a crash; it is a disabled user who keeps working for
 *  another 30 seconds. There are two levers, and they are not
 *  interchangeable:
 *
 *  - `invalidate*` — drop the cache. The next request re-reads. The session
 *    survives and the user stays logged in. For role changes, permission
 *    edits, profile and geography changes.
 *
 *  - `revoke*` — end the sessions outright, so every outstanding token for
 *    that principal stops working. For disabling, deleting and password
 *    changes.
 *
 *  The key is `auth:<principalId>` — one per principal, deliberately not per
 *  session. A mutation has no idea which session the user is holding, and
 *  eviction needs a key it can reconstruct from what it does know.
 */

export const AUTH_CACHE_TTL_MS = 30_000;

@Injectable()
export class AuthCacheService {
  private readonly logger = new Logger(AuthCacheService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  static cacheKey(principalId: string): string {
    return `auth:${principalId}`;
  }

  async get<T>(principalId: string): Promise<T | undefined> {
    return this.cache.get<T>(AuthCacheService.cacheKey(principalId));
  }

  async set<T>(principalId: string, value: T): Promise<void> {
    await this.cache.set(
      AuthCacheService.cacheKey(principalId),
      value,
      AUTH_CACHE_TTL_MS,
    );
  }

  /** Drop one principal's cache. The session survives. */
  async invalidatePrincipal(principalId: string): Promise<void> {
    await this.cache.del(AuthCacheService.cacheKey(principalId));
  }

  async invalidateMany(principalIds: string[]): Promise<void> {
    await Promise.all(principalIds.map((id) => this.invalidatePrincipal(id)));
  }

  /**
   * Drop the cache for everyone holding a given role.
   *
   * Editing a role's grants changes what every one of its holders may do, and
   * none of their cache entries know they depend on it. Reading the member list
   * to evict is the price of caching the resolved permissions rather than
   * re-deriving them per request.
   */
  async invalidateRole(tenantId: string, roleId: string): Promise<void> {
    const holders = await this.prisma.user.findMany({
      where: { tenantId, roleId },
      select: { id: true },
    });
    await this.invalidateMany(holders.map((u) => u.id));
  }

  /** Drop the cache for every user in a tenant — for tenant-level changes. */
  async invalidateTenant(tenantId: string): Promise<void> {
    const [users, investigators] = await Promise.all([
      this.prisma.user.findMany({ where: { tenantId }, select: { id: true } }),
      this.prisma.investigator.findMany({
        where: { tenantId },
        select: { id: true },
      }),
    ]);
    await this.invalidateMany([
      ...users.map((u) => u.id),
      ...investigators.map((i) => i.id),
    ]);
  }

  /**
   * End every session a principal holds, and drop their cache.
   *
   * Marks the sessions revoked rather than deleting them: a revoked row is
   * evidence, and the sessions list in user management is more useful showing
   * "ended by admin at 14:02" than showing nothing at all.
   */
  async revokePrincipalSessions(
    principalId: string,
    reason: string,
  ): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: {
        OR: [{ userId: principalId }, { investigatorId: principalId }],
        revokedAt: null,
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });

    await this.invalidatePrincipal(principalId);
    this.logger.log(
      `Revoked ${count} session(s) for principal ${principalId}: ${reason}`,
    );
    return count;
  }

  /** End every session in a tenant — suspension, subscription expiry. */
  async revokeTenantSessions(
    tenantId: string,
    reason: string,
  ): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { tenantId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    await this.invalidateTenant(tenantId);
    return count;
  }

  /**
   * A fresh opaque token. Used for refresh tokens and one-time links.
   *
   * 48 bytes because these are bearer secrets with a 30-day life, not session
   * identifiers — the cost of the extra entropy is nothing and the cost of
   * being wrong is an account.
   */
  static newOpaqueToken(): string {
    return randomBytes(48).toString('base64url');
  }

  /**
   * Run `fn` with no tenant filter.
   *
   * Authentication legitimately crosses tenants: resolving an email to a
   * principal happens before there is a tenant to scope to. Exposed here as a
   * named method so those call sites are greppable and reviewable, rather than
   * each one reaching for the raw context service.
   */
  runUnscoped<T>(fn: () => T | Promise<T>): Promise<T> {
    return this.requestContext.runAsSystem(fn, 'auth');
  }
}
