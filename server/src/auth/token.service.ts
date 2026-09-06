import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { PrincipalType } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthCacheService } from './auth-cache.service';
import { env, requireDuration, requireEnv } from '../common/config/env';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Token issue, rotation and revocation.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Two tokens, with different jobs:
 *
 *  ACCESS — a short-lived JWT (15 minutes) carried on every request. Stateless
 *  by design: verifying it is a signature check, not a database read. Its `jti`
 *  goes on a denylist when a session ends, which is checked only on the
 *  cache-miss path, so the common case stays free.
 *
 *  REFRESH — a long-lived opaque secret, stored only as a SHA-256 hash. It
 *  rotates on every use: the presented token is marked used and a new one is
 *  issued. That turns theft into something detectable rather than something
 *  permanent.
 *
 *  REUSE DETECTION. If an already-rotated refresh token is presented again,
 *  either the client replayed it or somebody stole it, and there is no way to
 *  tell which from here. Both are handled the same way: the entire session
 *  family is revoked. The legitimate user is logged out and has to sign in
 *  again — irritating, and far better than a thief holding a valid session for
 *  thirty days because the real user's replay looked innocent.
 *
 *  Refresh secrets are SHA-256, not bcrypt: they are 48 bytes of CSPRNG output
 *  with no guessable structure, so the work factor bcrypt buys against weak
 *  human passwords is irrelevant here, while the per-request cost of bcrypt on
 *  a hot path is not.
 */

export interface JwtPayload {
  /** Principal id — a `User.id` or an `Investigator.id`. */
  sub: string;
  /** Tenant, from the signed token and never from a request body. */
  tid: string;
  typ: PrincipalType;
  /** Session this token belongs to, so revocation can find its family. */
  sid: string;
  jti: string;
  iat?: number;
  exp?: number;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires — what a client schedules on. */
  expiresIn: number;
  sessionId: string;
}

export interface SessionOrigin {
  ip?: string;
  userAgent?: string;
  device?: string;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  private readonly accessTtl = requireDuration('JWT_ACCESS_EXPIRES_IN', '15m');
  private readonly userRefreshTtl = requireDuration(
    'JWT_REFRESH_EXPIRES_IN',
    '30d',
  );
  /**
   * Investigators re-authenticate far less conveniently than a desk user —
   * often outdoors, on a phone, with no way to reach IT — so their sessions
   * live longer. The trade is deliberate and is why it is a separate knob.
   */
  private readonly investigatorRefreshTtl = requireDuration(
    'JWT_INVESTIGATOR_REFRESH_EXPIRES_IN',
    '90d',
  );

  private readonly refreshSecret: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly authCache: AuthCacheService,
  ) {
    const dedicated = env('JWT_REFRESH_SECRET');
    if (dedicated) {
      this.refreshSecret = dedicated;
    } else {
      // Not fatal — the system is secure with one secret, just less
      // compartmented. Said loudly because the fix is one env var.
      this.logger.warn(
        'JWT_REFRESH_SECRET is not set; deriving refresh-token hashing from ' +
          'JWT_SECRET. Set a dedicated secret so a leaked access-token secret ' +
          'cannot also forge refresh tokens.',
      );
      this.refreshSecret = requireEnv('JWT_SECRET');
    }
  }

  /** SHA-256 of the refresh token, keyed by the refresh secret. */
  private hashRefresh(token: string): string {
    return createHash('sha256')
      .update(`${this.refreshSecret}:${token}`)
      .digest('hex');
  }

  private refreshTtlFor(principalType: PrincipalType): string {
    return principalType === PrincipalType.INVESTIGATOR
      ? this.investigatorRefreshTtl
      : this.userRefreshTtl;
  }

  /** Open a brand-new session and mint its first token pair. */
  async issue(
    principal: { id: string; tenantId: string; principalType: PrincipalType },
    origin: SessionOrigin = {},
  ): Promise<IssuedTokens> {
    const familyId = randomUUID();
    return this.mint(principal, familyId, origin);
  }

  /**
   * Exchange a refresh token for a new pair.
   *
   * Runs unscoped: the caller has presented only a bearer secret, so there is
   * no authenticated tenant to scope the lookup to yet. The tenant comes back
   * from the row and everything after that is scoped to it.
   */
  async rotate(
    refreshToken: string,
    origin: SessionOrigin = {},
  ): Promise<IssuedTokens> {
    const hash = this.hashRefresh(refreshToken);

    const session = await this.authCache.runUnscoped(() =>
      this.prisma.session.findUnique({
        where: { refreshTokenHash: hash },
      }),
    );

    if (!session) {
      throw new UnauthorizedException(
        'جلسة غير صالحة - Invalid or expired session',
      );
    }

    // Already exchanged. Either a replay or a theft — indistinguishable from
    // here, and both are answered by killing the family.
    if (session.rotatedAt) {
      await this.revokeFamily(session.familyId, 'refresh token reuse detected');
      this.logger.warn(
        `Refresh token reuse on family ${session.familyId} — every session in ` +
          `the family was revoked (principal ${session.userId ?? session.investigatorId}).`,
      );
      throw new UnauthorizedException(
        'تم اكتشاف إعادة استخدام رمز الجلسة، تم إنهاء جميع الجلسات - ' +
          'Session token reuse detected; all sessions were ended',
      );
    }

    if (session.revokedAt) {
      throw new UnauthorizedException('تم إنهاء الجلسة - Session was ended');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(
        'انتهت صلاحية الجلسة - Session has expired',
      );
    }

    const principalId = session.userId ?? session.investigatorId;
    if (!principalId) {
      throw new UnauthorizedException('جلسة غير صالحة - Invalid session');
    }

    // Close this link in the chain before opening the next, so a concurrent
    // second use of the same token finds it already rotated.
    await this.authCache.runUnscoped(() =>
      this.prisma.session.update({
        where: { id: session.id },
        data: { rotatedAt: new Date(), lastUsedAt: new Date() },
      }),
    );

    return this.mint(
      {
        id: principalId,
        tenantId: session.tenantId,
        principalType: session.principalType,
      },
      session.familyId,
      origin,
    );
  }

  /** Write a session row and sign the matching access token. */
  private async mint(
    principal: { id: string; tenantId: string; principalType: PrincipalType },
    familyId: string,
    origin: SessionOrigin,
  ): Promise<IssuedTokens> {
    const refreshToken = AuthCacheService.newOpaqueToken();
    const refreshTtl = this.refreshTtlFor(principal.principalType);

    const session = await this.authCache.runUnscoped(() =>
      this.prisma.session.create({
        data: {
          tenantId: principal.tenantId,
          principalType: principal.principalType,
          userId:
            principal.principalType === PrincipalType.WEB_USER
              ? principal.id
              : null,
          investigatorId:
            principal.principalType === PrincipalType.INVESTIGATOR
              ? principal.id
              : null,
          refreshTokenHash: this.hashRefresh(refreshToken),
          familyId,
          expiresAt: new Date(Date.now() + durationToMs(refreshTtl)),
          ip: origin.ip,
          userAgent: origin.userAgent,
          device: origin.device,
        },
        select: { id: true },
      }),
    );

    const payload: JwtPayload = {
      sub: principal.id,
      tid: principal.tenantId,
      typ: principal.principalType,
      sid: session.id,
      jti: randomUUID(),
    };

    const accessToken = await this.jwt.signAsync(payload, {
      // The TTL is kept as a plain string because `durationToMs` also reads it;
      // jsonwebtoken's types want its own template literal union here, and the
      // value has already been shape-checked by `requireDuration`.
      expiresIn: this.accessTtl as JwtSignOptions['expiresIn'],
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(durationToMs(this.accessTtl) / 1000),
      sessionId: session.id,
    };
  }

  /**
   * End one session and deny the access token that presented itself with it.
   *
   * The rest of the principal's sessions survive: "log out" means this device,
   * not every device, and a user logging out of a shared machine should not be
   * signed out on their phone.
   */
  async endSession(
    sessionId: string,
    jti: string | undefined,
    expSeconds: number | undefined,
    reason = 'logout',
  ): Promise<void> {
    await this.authCache.runUnscoped(async () => {
      await this.prisma.session
        .update({
          where: { id: sessionId },
          data: { revokedAt: new Date(), revokedReason: reason },
        })
        .catch(() => undefined);

      if (jti) {
        await this.denyToken(jti, sessionId, expSeconds, reason);
      }
    });
  }

  /** Revoke every session sharing a rotation family. */
  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.authCache.runUnscoped(() =>
      this.prisma.session.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      }),
    );
  }

  /**
   * Put an access token's `jti` on the denylist.
   *
   * The row expires when the token would have anyway, so the table stays the
   * size of the access-token window rather than growing forever.
   */
  async denyToken(
    jti: string,
    principalId: string,
    expSeconds: number | undefined,
    reason: string,
  ): Promise<void> {
    const expiresAt = expSeconds
      ? new Date(expSeconds * 1000)
      : new Date(Date.now() + durationToMs(this.accessTtl));

    await this.prisma.revokedToken
      .upsert({
        where: { jti },
        create: { jti, principalId, expiresAt, reason },
        update: {},
      })
      .catch((error) => {
        // Fail open, deliberately. This is a belt-and-braces check on top of
        // session revocation, which lives in Postgres and always works. A
        // missing migration here must not make logout throw.
        this.logger.warn(
          `Could not record token revocation for ${jti}: ${String(error)}`,
        );
      });
  }

  /**
   * Whether an access token has been denied.
   *
   * FAILS OPEN. If this table cannot be read the request proceeds, because the
   * alternative — every request failing closed on an infrastructure blip — locks
   * every user out of a system that field staff depend on. Session state in
   * Postgres remains the authoritative check.
   */
  async isDenied(jti: string | undefined): Promise<boolean> {
    if (!jti) return false;
    try {
      const row = await this.prisma.revokedToken.findUnique({
        where: { jti },
        select: { jti: true },
      });
      return Boolean(row);
    } catch (error) {
      this.logger.warn(`Denylist lookup failed, allowing: ${String(error)}`);
      return false;
    }
  }

  /** Remove expired denylist rows and sessions. Called by the nightly sweep. */
  async pruneExpired(): Promise<{ tokens: number; sessions: number }> {
    const now = new Date();
    const [tokens, sessions] = await Promise.all([
      this.prisma.revokedToken.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
      this.prisma.session.deleteMany({
        where: {
          expiresAt: { lt: new Date(now.getTime() - 7 * 24 * 3600 * 1000) },
        },
      }),
    ]);
    return { tokens: tokens.count, sessions: sessions.count };
  }
}

/**
 * Convert a `jsonwebtoken` duration string to milliseconds.
 *
 * Validated at construction by `requireDuration`, so anything reaching here is
 * already well-formed; the fallback exists only so a future caller cannot get
 * NaN silently.
 */
export function durationToMs(duration: string): number {
  const match = /^(\d+)(ms|s|m|h|d|w|y)?$/.exec(duration.trim());
  if (!match) return 0;

  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    y: 31_536_000_000,
  };
  return value * (multipliers[unit] ?? 1000);
}
