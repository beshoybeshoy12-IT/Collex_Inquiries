import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AnnouncementPriority, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Company announcements for office staff.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  VISIBILITY IS DECIDED HERE, NOT IN THE BROWSER. A reader sees an
 *  announcement when it is not deleted, not expired, and its audience is
 *  empty (everyone) or includes the reader's role. A manager
 *  (`announcements.manage`) sees every live one, including those aimed at
 *  other roles, so they can edit what they published — plus who has read it.
 *
 *  Expired ones are not deleted: they leave the feed and stay in the audit
 *  trail's reach. A manager can still list them with `includeExpired`.
 *
 *  The socket carries a signal, never the text: the feed refetches over REST,
 *  where the audience filter lives.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private canManage(user: AuthenticatedUser): boolean {
    return (
      user.isSuperAdmin || user.permissions.includes(P.ANNOUNCEMENTS_MANAGE)
    );
  }

  async feed(
    tenantId: string,
    user: AuthenticatedUser,
    includeExpired = false,
  ) {
    const now = new Date();
    const manager = this.canManage(user);

    const where: Prisma.AnnouncementWhereInput = {
      tenantId,
      deletedAt: null,
      ...(manager && includeExpired
        ? {}
        : { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }),
      ...(manager
        ? {}
        : {
            AND: [
              {
                OR: [
                  { audienceRoleIds: { isEmpty: true } },
                  ...(user.roleId
                    ? [{ audienceRoleIds: { has: user.roleId } }]
                    : []),
                ],
              },
            ],
          }),
    };

    const rows = await this.prisma.announcement.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: {
        createdBy: { select: { id: true, fullName: true } },
        reads: { where: { userId: user.id }, select: { readAt: true } },
        _count: { select: { reads: true } },
      },
    });

    // For managers: how many people each one was aimed at, to show "7 / 12".
    const audienceSizes = manager ? await this.audienceSizes(tenantId) : null;

    const items = rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      priority: row.priority,
      pinned: row.pinned,
      audienceRoleIds: row.audienceRoleIds,
      expiresAt: row.expiresAt,
      expired: row.expiresAt ? row.expiresAt <= now : false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      author: row.createdBy,
      readAt: row.reads[0]?.readAt ?? null,
      ...(audienceSizes
        ? {
            readCount: row._count.reads,
            audienceCount: audienceSizes(row.audienceRoleIds),
          }
        : {}),
    }));

    // Urgent first among the unpinned is not done: pinned is the manager's
    // explicit ordering, and newest-first is what people expect of a feed.
    // Urgency is shown, and counted for the badge.
    return {
      canManage: manager,
      unread: items.filter((item) => !item.readAt && !item.expired).length,
      items,
    };
  }

  /** Active users per role, as a function from an audience to a head count. */
  private async audienceSizes(tenantId: string) {
    const groups = await this.prisma.user.groupBy({
      by: ['roleId'],
      where: { tenantId, deletedAt: null, status: UserStatus.ACTIVE },
      _count: { _all: true },
    });
    const total = groups.reduce((sum, g) => sum + g._count._all, 0);
    const byRole = new Map(groups.map((g) => [g.roleId, g._count._all]));
    return (roleIds: string[]) =>
      roleIds.length === 0
        ? total
        : roleIds.reduce((sum, id) => sum + (byRole.get(id) ?? 0), 0);
  }

  /** Readers of one announcement — for its publisher. */
  async readers(tenantId: string, id: string) {
    await this.findLive(tenantId, id);
    const reads = await this.prisma.announcementRead.findMany({
      where: { tenantId, announcementId: id },
      orderBy: { readAt: 'desc' },
      include: { user: { select: { id: true, fullName: true } } },
    });
    return reads.map((read) => ({ user: read.user, readAt: read.readAt }));
  }

  async create(
    tenantId: string,
    user: AuthenticatedUser,
    dto: CreateAnnouncementDto,
  ) {
    const audienceRoleIds = await this.checkRoles(
      tenantId,
      dto.audienceRoleIds ?? [],
    );

    const created = await this.prisma.announcement.create({
      data: {
        tenantId,
        title: dto.title,
        body: dto.body,
        priority: dto.priority ?? AnnouncementPriority.NORMAL,
        pinned: dto.pinned ?? false,
        audienceRoleIds,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdById: user.id,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'ANNOUNCEMENT_CREATED',
      category: 'SETTINGS',
      entityType: 'Announcement',
      entityId: created.id,
      entityLabel: created.title,
      newValue: { priority: created.priority, pinned: created.pinned },
    });
    this.signal(tenantId, created.id);
    return created;
  }

  async update(tenantId: string, id: string, dto: UpdateAnnouncementDto) {
    await this.findLive(tenantId, id);

    const updated = await this.prisma.announcement.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
        ...(dto.audienceRoleIds !== undefined
          ? {
              audienceRoleIds: await this.checkRoles(
                tenantId,
                dto.audienceRoleIds,
              ),
            }
          : {}),
        ...(dto.expiresAt !== undefined
          ? { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null }
          : {}),
      },
    });

    await this.audit.log({
      tenantId,
      action: 'ANNOUNCEMENT_UPDATED',
      category: 'SETTINGS',
      entityType: 'Announcement',
      entityId: id,
      entityLabel: updated.title,
    });
    this.signal(tenantId, id);
    return updated;
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.findLive(tenantId, id);
    await this.prisma.announcement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      tenantId,
      action: 'ANNOUNCEMENT_DELETED',
      category: 'SETTINGS',
      severity: 'NOTICE',
      entityType: 'Announcement',
      entityId: id,
      entityLabel: existing.title,
    });
    this.signal(tenantId, id);
    return { deleted: true };
  }

  /**
   * Mark as read. Idempotent, and only for an announcement the reader can
   * actually see — otherwise "mark read" would confirm an id exists.
   */
  async markRead(tenantId: string, user: AuthenticatedUser, id: string) {
    const { items } = await this.feed(tenantId, user, true);
    if (!items.some((item) => item.id === id)) {
      throw new NotFoundException('الإعلان غير موجود - Announcement not found');
    }

    await this.prisma.announcementRead.createMany({
      data: [{ tenantId, announcementId: id, userId: user.id }],
      skipDuplicates: true,
    });
    return { read: true };
  }

  private async findLive(tenantId: string, id: string) {
    const row = await this.prisma.announcement.findFirst({
      where: { tenantId, id, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException('الإعلان غير موجود - Announcement not found');
    }
    return row;
  }

  /** Role ids must belong to this company; anything else is refused. */
  private async checkRoles(tenantId: string, roleIds: string[]) {
    const unique = [...new Set(roleIds)];
    if (unique.length === 0) return [];
    const found = await this.prisma.role.count({
      where: { tenantId, id: { in: unique } },
    });
    if (found !== unique.length) {
      throw new BadRequestException('دور غير معروف - Unknown role in audience');
    }
    return unique;
  }

  private signal(tenantId: string, announcementId: string) {
    this.realtime.emitToTenant(tenantId, 'announcement:changed', {
      announcementId,
    });
  }
}
