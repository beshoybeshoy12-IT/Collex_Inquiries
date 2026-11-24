import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DeviceToken, PrincipalType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../common/context/request-context';
import { env } from '../common/config/env';
import { PushDriver, PushMessage, PushResult } from './push.driver';
import { LogPushDriver } from './drivers/log.driver';
import { FcmPushDriver } from './drivers/fcm.driver';
import { RegisterDeviceDto } from './dto/device.dto';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Push notifications — registration and delivery.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  NOTHING IN THE APPLICATION KNOWS WHICH PROVIDER IS BEHIND THIS, exactly as
 *  with `StorageService`. Callers hand over a principal and a message; whether
 *  that becomes an FCM call, an APNs call or a log line is one environment
 *  variable. The lesson is the same one storage learned: a provider wired
 *  directly into a dozen services makes "switch provider" a refactor.
 *
 *  NO PROVIDER IS CONFIGURED IN THIS BUILD, AND NOTHING PRETENDS OTHERWISE.
 *  `LogPushDriver` returns `SKIPPED`, never `SENT`, and the reason it gives is
 *  written into the notification's `deliveryStatus` where anybody can read it.
 *  A no-op that reported success would make "is push working?" answer yes on a
 *  system that has never delivered anything.
 *
 *  DELIVERY NEVER FAILS THE CALLER. Like the audit trail and the socket emit,
 *  this runs alongside operations that must not roll back because a phone could
 *  not be reached. Every path here catches its own errors.
 *
 *  THE TOKEN IS THE IDENTITY OF A HANDSET, NOT OF A PERSON. It is unique
 *  globally and re-registering MOVES it — see `register`.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private readonly driver: PushDriver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {
    const name = env('PUSH_DRIVER', 'none').toLowerCase();

    // FCM is called directly — no Expo push service in between. `fcm` with
    // missing credentials throws here, so a misconfigured deploy fails at boot.
    switch (name) {
      case 'fcm':
        this.driver = new FcmPushDriver();
        break;
      default:
        this.driver = new LogPushDriver();
    }
  }

  onModuleInit(): void {
    if (this.driver.configured) {
      this.logger.log(`Push driver: ${this.driver.name}`);
      return;
    }

    // Said once, at boot, in the same place the storage driver says it. An
    // operator who never sees this line and never sees a push has nothing to
    // go on.
    this.logger.warn(
      'PUSH_DRIVER is not configured — device registration works and every ' +
        'notification records what it would have sent, but no push is ' +
        'delivered to any handset.',
    );
  }

  /** Whether a real provider is behind this. Reported by /readiness. */
  get configured(): boolean {
    return this.driver.configured;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Registration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Register this handset, or move it.
   *
   * THE INTERESTING CASE IS THE SECOND ONE. A registration token belongs to an
   * app installation, not to a person: a field phone gets handed to a
   * colleague, somebody signs out and a different investigator signs in, and
   * the provider issues that same installation the same token. If the old row
   * survived, the previous investigator's case numbers would keep arriving on
   * a phone that is no longer theirs — including, across tenants, another
   * company's case numbers.
   *
   * So the old row is deleted and a new one written, in one transaction, under
   * `runAsSystem`. That is deliberate and it is the reviewed way to cross a
   * tenant boundary in this codebase — the alternative, scoping the lookup to
   * the caller's tenant, would find nothing, hit the global unique constraint,
   * 500, and leave the stale row delivering.
   *
   * `tenantId` is passed explicitly on the create because the guard does not
   * fill it in under `runAsSystem`.
   */
  async register(
    tenantId: string,
    principal: { id: string; principalType: PrincipalType },
    dto: RegisterDeviceDto,
  ): Promise<DeviceToken> {
    const owner =
      principal.principalType === PrincipalType.WEB_USER
        ? { userId: principal.id }
        : { investigatorId: principal.id };

    return this.requestContext.runAsSystem(async () => {
      const [, created] = await this.prisma.$transaction([
        // deleteMany, not delete: a token registering for the first time has
        // no row, and `delete` would throw on the common path.
        this.prisma.deviceToken.deleteMany({ where: { token: dto.token } }),
        this.prisma.deviceToken.create({
          data: {
            tenantId,
            principalType: principal.principalType,
            ...owner,
            token: dto.token,
            platform: dto.platform,
            appVersion: dto.appVersion,
            deviceModel: dto.deviceModel,
            osVersion: dto.osVersion,
            locale: dto.locale ?? 'ar',
            lastSeenAt: new Date(),
          },
        }),
      ]);

      return created;
    }, 'device-registration');
  }

  /**
   * Unregister one handset — what the app calls on sign-out.
   *
   * Scoped to the caller: a token nobody owns, or somebody else's, reports zero
   * removed rather than 404. Confirming a token exists is a small oracle and
   * there is no reason to offer it.
   */
  async unregister(
    tenantId: string,
    principal: { id: string; principalType: PrincipalType },
    token: string,
  ): Promise<{ removed: number }> {
    const { count } = await this.prisma.deviceToken.deleteMany({
      where: {
        tenantId,
        token,
        ...(principal.principalType === PrincipalType.WEB_USER
          ? { userId: principal.id }
          : { investigatorId: principal.id }),
      },
    });
    return { removed: count };
  }

  /**
   * Disable every handset a principal has registered.
   *
   * For "sign out of all devices", which is the button somebody presses when a
   * phone has been lost. Without this it ends the sessions and leaves case
   * numbers arriving on the lock screen of a handset in somebody else's hand.
   *
   * Disabled rather than deleted: a device that comes back re-registers and
   * gets a fresh row, and meanwhile the count of handsets that went quiet is
   * still answerable.
   */
  async disableForPrincipal(
    principalId: string,
    principalType: PrincipalType,
    reason: string,
  ): Promise<number> {
    try {
      const { count } = await this.prisma.deviceToken.updateMany({
        where: {
          disabledAt: null,
          ...(principalType === PrincipalType.WEB_USER
            ? { userId: principalId }
            : { investigatorId: principalId }),
        },
        data: { disabledAt: new Date(), disabledReason: reason },
      });
      return count;
    } catch (error) {
      // Called from the sign-out path. Signing out must succeed even if this
      // does not.
      this.logger.error(
        `Failed to disable device tokens for ${principalId}: ${String(error)}`,
      );
      return 0;
    }
  }

  /** A principal's own registered handsets. Tokens are never returned. */
  async listForPrincipal(
    tenantId: string,
    principal: { id: string; principalType: PrincipalType },
  ) {
    return this.prisma.deviceToken.findMany({
      where: {
        tenantId,
        ...(principal.principalType === PrincipalType.WEB_USER
          ? { userId: principal.id }
          : { investigatorId: principal.id }),
      },
      // The token itself is a credential of sorts — whoever holds it can push
      // to that handset. The app already knows its own; nothing needs it back.
      select: {
        id: true,
        platform: true,
        deviceModel: true,
        osVersion: true,
        appVersion: true,
        locale: true,
        lastSeenAt: true,
        disabledAt: true,
        disabledReason: true,
        createdAt: true,
      },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Delivery
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Push one notification to every handset a principal has registered.
   *
   * Returns a delivery record rather than throwing, because the caller writes
   * it onto the notification row and must not care whether it went well.
   */
  async deliver(input: {
    tenantId: string;
    principalId: string;
    principalType: PrincipalType;
    titleAr: string;
    titleEn: string;
    bodyAr: string;
    bodyEn: string;
    data?: Record<string, string>;
    highPriority?: boolean;
  }): Promise<PushDeliveryRecord> {
    const at = new Date().toISOString();

    try {
      const devices = await this.prisma.deviceToken.findMany({
        where: {
          tenantId: input.tenantId,
          disabledAt: null,
          ...(input.principalType === PrincipalType.WEB_USER
            ? { userId: input.principalId }
            : { investigatorId: input.principalId }),
        },
        select: { token: true, locale: true },
      });

      if (devices.length === 0) {
        return {
          driver: this.driver.name,
          attempted: 0,
          sent: 0,
          failed: 0,
          detail: 'no registered devices',
          at,
        };
      }

      const messages: PushMessage[] = devices.map((device) => ({
        token: device.token,
        // Both halves are stored on the notification precisely so this choice
        // can be made per handset — two investigators on one case may read
        // different languages.
        title: device.locale === 'en' ? input.titleEn : input.titleAr,
        body: device.locale === 'en' ? input.bodyEn : input.bodyAr,
        data: input.data,
        highPriority: input.highPriority,
      }));

      const results = await this.driver.send(messages);
      await this.retireUnregistered(results);

      const sent = results.filter((r) => r.outcome === 'SENT').length;
      const failed = results.filter((r) => r.outcome === 'FAILED').length;
      const retired = results.filter((r) => r.outcome === 'UNREGISTERED').length;

      return {
        driver: this.driver.name,
        attempted: messages.length,
        sent,
        failed,
        ...(retired ? { retired } : {}),
        // The first non-SENT reason, so the record says *why* rather than only
        // that the count was zero.
        detail:
          results.find((r) => r.outcome !== 'SENT')?.detail ??
          (sent > 0 ? 'delivered' : undefined),
        at,
      };
    } catch (error) {
      this.logger.error(`Push delivery failed: ${String(error)}`);
      return {
        driver: this.driver.name,
        attempted: 0,
        sent: 0,
        failed: 0,
        detail: `delivery error: ${String(error)}`,
        at,
      };
    }
  }

  /**
   * A token the provider has told us is dead.
   *
   * Marked, not deleted, and the mark is what stops the next delivery reading
   * it. Retrying a token the provider has rejected is how an application ends
   * up rate-limited by its own push provider.
   *
   * Runs unscoped: a batch may span nothing but one tenant today, and this
   * still should not depend on which context happened to be bound.
   */
  private async retireUnregistered(results: PushResult[]): Promise<void> {
    const dead = results
      .filter((result) => result.outcome === 'UNREGISTERED')
      .map((result) => result.token);

    if (dead.length === 0) return;

    await this.requestContext.runAsSystem(
      () =>
        this.prisma.deviceToken.updateMany({
          where: { token: { in: dead }, disabledAt: null },
          data: {
            disabledAt: new Date(),
            disabledReason: 'provider reported the token is no longer valid',
          },
        }),
      'push-token-retirement',
    );

    this.logger.log(`Retired ${dead.length} unregistered device token(s)`);
  }
}

/** What gets written into `Notification.deliveryStatus`. */
export interface PushDeliveryRecord {
  driver: string;
  attempted: number;
  sent: number;
  failed: number;
  retired?: number;
  detail?: string;
  at: string;
}

/** So the record can be stored in a Prisma `Json` column without a cast dance. */
export function asJson(record: PushDeliveryRecord): Prisma.InputJsonValue {
  return record as unknown as Prisma.InputJsonValue;
}
