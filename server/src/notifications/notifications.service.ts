import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationType,
  PrincipalType,
  Prisma,
  Priority,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { paginate } from '../common/interfaces/api.interface';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

export interface NotificationInput {
  type: keyof typeof NotificationType;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  entityType?: string;
  entityId?: string;
  link?: string;
  priority?: keyof typeof Priority;
  channels?: NotificationChannel[];
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Notifications.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ONE ROW PER RECIPIENT. A notification is addressed to exactly one principal.
 *  A "broadcast" fans out into rows rather than being one row everybody reads,
 *  because otherwise "mark as read" has nowhere to live and every unread count
 *  in the system becomes a lie.
 *
 *  BOTH LANGUAGES ARE STORED. A notification outlives the request that created
 *  it, and the person who reads it may not share the language of the person
 *  who caused it. Storing a translation key instead would work until a message
 *  needed to name a case number, at which point the key needs parameters and
 *  the parameters need storing anyway.
 *
 *  DELIVERY NEVER FAILS THE CALLER. Like the audit trail, these are written
 *  alongside operations that must not be rolled back because a notification
 *  could not be created. Failures are logged and swallowed.
 *
 *  PUSH IS PREPARED, NOT PRETENDED. `channels` can name PUSH and the row
 *  records it, but nothing in this build talks to FCM or APNs — the mobile
 *  application does not exist yet. `deliveryStatus` is where the outcome will
 *  go when it does. Nothing here claims a push was sent.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Notify one web user. */
  async notifyUser(
    tenantId: string,
    userId: string,
    input: NotificationInput,
  ): Promise<void> {
    await this.create(tenantId, {
      recipientType: PrincipalType.WEB_USER,
      userId,
      ...input,
    });
  }

  /** Notify one field investigator. */
  async notifyInvestigator(
    tenantId: string,
    investigatorId: string,
    input: NotificationInput,
  ): Promise<void> {
    await this.create(tenantId, {
      recipientType: PrincipalType.INVESTIGATOR,
      investigatorId,
      ...input,
    });
  }

  /**
   * Notify every user holding one of the named role codes.
   *
   * Roles rather than user ids, so an escalation rule survives the person who
   * held the job leaving.
   */
  async notifyRoles(
    tenantId: string,
    roleCodes: string[],
    input: NotificationInput,
  ): Promise<number> {
    if (roleCodes.length === 0) return 0;

    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        deletedAt: null,
        role: { code: { in: roleCodes } },
      },
      select: { id: true },
    });

    await Promise.all(
      users.map((user) => this.notifyUser(tenantId, user.id, input)),
    );
    return users.length;
  }

  private async create(
    tenantId: string,
    data: NotificationInput & {
      recipientType: PrincipalType;
      userId?: string;
      investigatorId?: string;
    },
  ): Promise<void> {
    try {
      const row = await this.prisma.notification.create({
        data: {
          tenantId,
          recipientType: data.recipientType,
          userId: data.userId,
          investigatorId: data.investigatorId,
          type: NotificationType[data.type],
          channels: data.channels ?? [NotificationChannel.IN_APP],
          titleAr: data.titleAr,
          titleEn: data.titleEn,
          bodyAr: data.bodyAr,
          bodyEn: data.bodyEn,
          entityType: data.entityType,
          entityId: data.entityId,
          link: data.link,
          priority: Priority[data.priority ?? 'NORMAL'],
        },
      });

      // Push it down the socket so the bell updates without waiting for the
      // next poll. Best-effort: a client that is not connected reads it on its
      // next fetch, which is what the row is for.
      const recipientId = data.userId ?? data.investigatorId;
      if (recipientId) {
        this.realtime.emitToPrincipal(recipientId, 'notification:new', {
          id: row.id,
          type: row.type,
          titleAr: row.titleAr,
          titleEn: row.titleEn,
          bodyAr: row.bodyAr,
          bodyEn: row.bodyEn,
          link: row.link,
          priority: row.priority,
          createdAt: row.createdAt,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to create ${data.type} notification: ${String(error)}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Reads — always scoped to the caller
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * A principal's own inbox.
   *
   * Deliberately takes the principal id rather than accepting one as a
   * parameter from anywhere: "read someone else's notifications" is a request
   * with nowhere to be expressed, which is the whole security model of this
   * module.
   */
  async listForPrincipal(
    tenantId: string,
    principalId: string,
    principalType: PrincipalType,
    query: PaginationQueryDto & { unreadOnly?: boolean },
  ) {
    const where: Prisma.NotificationWhereInput = {
      tenantId,
      ...(principalType === PrincipalType.WEB_USER
        ? { userId: principalId }
        : { investigatorId: principalId }),
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const [rows, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { ...where, readAt: null },
      }),
    ]);

    return { ...paginate(rows, total, query.page, query.limit), unread };
  }

  async unreadCount(
    tenantId: string,
    principalId: string,
    principalType: PrincipalType,
  ): Promise<number> {
    return this.prisma.notification.count({
      where: {
        tenantId,
        readAt: null,
        ...(principalType === PrincipalType.WEB_USER
          ? { userId: principalId }
          : { investigatorId: principalId }),
      },
    });
  }

  /**
   * Mark one as read.
   *
   * `updateMany` with the ownership predicate, not `update` by id: that way a
   * request naming someone else's notification affects zero rows instead of
   * needing a separate read-then-check, and there is no window between the two.
   */
  async markRead(
    tenantId: string,
    principalId: string,
    principalType: PrincipalType,
    notificationId: string,
  ) {
    const { count } = await this.prisma.notification.updateMany({
      where: {
        tenantId,
        id: notificationId,
        readAt: null,
        ...(principalType === PrincipalType.WEB_USER
          ? { userId: principalId }
          : { investigatorId: principalId }),
      },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  async markAllRead(
    tenantId: string,
    principalId: string,
    principalType: PrincipalType,
  ) {
    const { count } = await this.prisma.notification.updateMany({
      where: {
        tenantId,
        readAt: null,
        ...(principalType === PrincipalType.WEB_USER
          ? { userId: principalId }
          : { investigatorId: principalId }),
      },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  async remove(
    tenantId: string,
    principalId: string,
    principalType: PrincipalType,
    notificationId: string,
  ) {
    const { count } = await this.prisma.notification.deleteMany({
      where: {
        tenantId,
        id: notificationId,
        ...(principalType === PrincipalType.WEB_USER
          ? { userId: principalId }
          : { investigatorId: principalId }),
      },
    });
    return { deleted: count };
  }

  /** Retention sweep. Read notifications only — an unread one is still owed. */
  async pruneOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const { count } = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: cutoff }, readAt: { not: null } },
    });
    return count;
  }
}
