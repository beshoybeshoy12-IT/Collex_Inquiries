import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrincipalType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { sniffSignature } from '../common/utils/file-signature.util';
import { safeFileName } from '../common/utils/file-name.util';
import { AuthenticatedPrincipal } from '../common/decorators/auth.decorators';
import {
  attachmentType,
  ChatParty,
  cleanBody,
  MAX_BODY_LENGTH,
  MAX_FILE_BYTES,
  MAX_FILES_PER_MESSAGE,
  mayTalk,
  pairKey,
  retentionDaysFrom,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
} from './chat.util';

const MESSAGE_INCLUDE = {
  attachments: {
    select: { id: true, fileName: true, mimeType: true, size: true },
  },
} satisfies Prisma.ChatMessageInclude;

type MessageRow = Prisma.ChatMessageGetPayload<{
  include: typeof MESSAGE_INCLUDE;
}>;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Internal chat — one-to-one, between office staff and field investigators.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  INSIDE ONE COMPANY ONLY. Every query is tenant-scoped by the Prisma guard,
 *  and a conversation id that is not the caller's own is a 404, never a 403:
 *  the answer must not confirm the thread exists.
 *
 *  SIGNALS, NOT DATA, over the socket — "conversation X changed" — and the
 *  client refetches over REST, so the participant check lives in one place.
 *
 *  FILES are accepted by their bytes, not their name or the uploader's
 *  Content-Type, stored under `t/<tenant>/chat/`, served only to the two
 *  participants, and every download is audited.
 *
 *  RETENTION is a company setting (`chatRetentionDays`, default a year):
 *  older messages and their files are removed by the nightly sweep.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ── People ──────────────────────────────────────────────────────────────

  /** Who the caller may start a conversation with. */
  async contacts(principal: AuthenticatedPrincipal, search?: string) {
    const me = partyOf(principal);
    const term = search?.trim();
    const nameFilter = term
      ? { fullName: { contains: term, mode: 'insensitive' as const } }
      : {};

    const [users, investigators] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          tenantId: principal.tenantId,
          deletedAt: null,
          status: 'ACTIVE',
          ...nameFilter,
        },
        select: {
          id: true,
          fullName: true,
          role: { select: { nameAr: true, nameEn: true } },
        },
        orderBy: { fullName: 'asc' },
        take: 100,
      }),
      me.type === PrincipalType.INVESTIGATOR
        ? Promise.resolve([])
        : this.prisma.investigator.findMany({
            where: {
              tenantId: principal.tenantId,
              deletedAt: null,
              status: { in: ['ACTIVE', 'IN_TRAINING'] },
              ...nameFilter,
            },
            select: { id: true, fullName: true, employeeCode: true },
            orderBy: { fullName: 'asc' },
            take: 100,
          }),
    ]);

    return [
      ...users.map((user) => ({
        type: PrincipalType.WEB_USER,
        id: user.id,
        name: user.fullName,
        roleAr: user.role?.nameAr ?? null,
        roleEn: user.role?.nameEn ?? null,
      })),
      ...investigators.map((investigator) => ({
        type: PrincipalType.INVESTIGATOR,
        id: investigator.id,
        name: investigator.fullName,
        roleAr: `باحث ميداني · ${investigator.employeeCode}`,
        roleEn: `Field investigator · ${investigator.employeeCode}`,
      })),
    ].filter((contact) => mayTalk(me, contact));
  }

  // ── Conversations ───────────────────────────────────────────────────────

  /** The caller's conversations, newest first, each with the other side. */
  async list(principal: AuthenticatedPrincipal) {
    const me = partyOf(principal);
    const mine = await this.prisma.chatParticipant.findMany({
      where: {
        tenantId: principal.tenantId,
        principalType: me.type,
        principalId: me.id,
      },
      select: {
        lastReadAt: true,
        conversation: {
          select: {
            id: true,
            lastMessageAt: true,
            participants: {
              select: {
                principalType: true,
                principalId: true,
                lastReadAt: true,
              },
            },
          },
        },
      },
      orderBy: {
        conversation: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      },
      take: 200,
    });

    const others = mine.map((row) =>
      row.conversation.participants.find(
        (p) => !(p.principalType === me.type && p.principalId === me.id),
      )!,
    );
    const names = await this.namesFor(principal.tenantId, others);

    return Promise.all(
      mine.map(async (row, index) => {
        const conversationId = row.conversation.id;
        const [last, unread] = await Promise.all([
          this.prisma.chatMessage.findFirst({
            where: { conversationId },
            orderBy: { createdAt: 'desc' },
            include: MESSAGE_INCLUDE,
          }),
          this.unreadIn(conversationId, me, row.lastReadAt),
        ]);
        const other = others[index];
        return {
          id: conversationId,
          lastMessageAt: row.conversation.lastMessageAt,
          unread,
          other: {
            type: other.principalType,
            id: other.principalId,
            ...names.get(`${other.principalType}:${other.principalId}`),
          },
          last: last ? this.toDto(last, me) : null,
        };
      }),
    );
  }

  /** Get, or start, the conversation between the caller and one person. */
  async open(principal: AuthenticatedPrincipal, target: ChatParty) {
    const me = partyOf(principal);
    if (!mayTalk(me, target)) {
      throw new BadRequestException(
        'لا يمكن بدء هذه المحادثة - This conversation is not allowed',
      );
    }
    await this.assertExists(principal.tenantId, target);

    const key = pairKey(me, target);
    const existing = await this.prisma.chatConversation.findFirst({
      where: { tenantId: principal.tenantId, pairKey: key },
      select: { id: true },
    });
    if (existing) return { id: existing.id };

    try {
      const created = await this.prisma.chatConversation.create({
        data: {
          tenantId: principal.tenantId,
          pairKey: key,
          participants: {
            create: [me, target].map((party) => ({
              tenantId: principal.tenantId,
              principalType: party.type,
              principalId: party.id,
            })),
          },
        },
        select: { id: true },
      });
      return { id: created.id };
    } catch (error) {
      // Two first messages at once: the unique pair key let one through.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.chatConversation.findFirst({
          where: { tenantId: principal.tenantId, pairKey: key },
          select: { id: true },
        });
        if (winner) return { id: winner.id };
      }
      throw error;
    }
  }

  /**
   * One page of a conversation, oldest first, ending before `before` (an
   * ISO date) when given — the window scrolls back through history.
   */
  async messages(
    principal: AuthenticatedPrincipal,
    conversationId: string,
    before?: string,
    limit = 40,
  ) {
    const me = partyOf(principal);
    const conversation = await this.loadMine(principal, conversationId);
    const cursor = before ? new Date(before) : null;

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        ...(cursor && !Number.isNaN(cursor.getTime())
          ? { createdAt: { lt: cursor } }
          : {}),
      },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100) + 1,
    });

    const page = Math.min(Math.max(limit, 1), 100);
    const hasMore = rows.length > page;
    const other = conversation.participants.find(
      (p) => !(p.principalType === me.type && p.principalId === me.id),
    )!;
    const names = await this.namesFor(principal.tenantId, [other]);

    return {
      conversationId,
      hasMore,
      other: {
        type: other.principalType,
        id: other.principalId,
        lastReadAt: other.lastReadAt,
        ...names.get(`${other.principalType}:${other.principalId}`),
      },
      messages: rows
        .slice(0, page)
        .reverse()
        .map((row) => this.toDto(row, me)),
    };
  }

  /** Send a message: text, files, or both. */
  async send(
    principal: AuthenticatedPrincipal,
    conversationId: string,
    rawBody: string | undefined,
    files: Express.Multer.File[] = [],
  ) {
    const me = partyOf(principal);
    const conversation = await this.loadMine(principal, conversationId);
    const body = cleanBody(rawBody);

    if (!body && files.length === 0) {
      throw new BadRequestException('الرسالة فارغة - The message is empty');
    }
    if (body && body.length > MAX_BODY_LENGTH) {
      throw new BadRequestException(
        `الرسالة أطول من ${MAX_BODY_LENGTH} حرف - The message is longer than ${MAX_BODY_LENGTH} characters`,
      );
    }
    if (files.length > MAX_FILES_PER_MESSAGE) {
      throw new BadRequestException(
        `الحد الأقصى ${MAX_FILES_PER_MESSAGE} ملفات في الرسالة - At most ${MAX_FILES_PER_MESSAGE} files per message`,
      );
    }

    // Check every file before storing any, so a bad one stores nothing.
    const accepted = files.map((file) => {
      const fileName = safeFileName(file.originalname);
      if (!file.buffer?.length) {
        throw new BadRequestException(`الملف فارغ - Empty file: ${fileName}`);
      }
      if (file.size > MAX_FILE_BYTES) {
        throw new BadRequestException(
          `الملف أكبر من 20 ميجابايت - Larger than 20 MB: ${fileName}`,
        );
      }
      const mimeType = attachmentType(sniffSignature(file.buffer), fileName);
      if (!mimeType) {
        throw new BadRequestException({
          message: `نوع الملف غير مسموح - File type not allowed: ${fileName}`,
          errorCode: 'UNSUPPORTED_FILE',
        });
      }
      return { file, fileName, mimeType };
    });

    const stored: ((typeof accepted)[number] & { key: string })[] = [];
    for (const item of accepted) {
      const object = await this.storage.putObject({
        tenantId: principal.tenantId,
        prefix: 'chat',
        fileName: item.fileName,
        contentType: item.mimeType,
        body: item.file.buffer,
      });
      stored.push({ ...item, key: object.key });
    }

    const now = new Date();
    const message = await this.prisma.chatMessage.create({
      data: {
        tenantId: principal.tenantId,
        conversationId,
        senderType: me.type,
        senderId: me.id,
        body,
        createdAt: now,
        attachments: {
          create: stored.map((item) => ({
            tenantId: principal.tenantId,
            storageKey: item.key,
            fileName: item.fileName,
            mimeType: item.mimeType,
            size: item.file.size,
          })),
        },
      },
      include: MESSAGE_INCLUDE,
    });

    await this.prisma.$transaction([
      this.prisma.chatConversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: now },
      }),
      // Sending is reading: the sender has seen everything up to their message.
      this.prisma.chatParticipant.updateMany({
        where: {
          conversationId,
          principalType: me.type,
          principalId: me.id,
        },
        data: { lastReadAt: now },
      }),
    ]);

    this.signal(conversation.participants, 'chat:message', { conversationId });
    return this.toDto(message, me);
  }

  /** Mark the conversation read up to now. */
  async markRead(principal: AuthenticatedPrincipal, conversationId: string) {
    const me = partyOf(principal);
    const conversation = await this.loadMine(principal, conversationId);
    await this.prisma.chatParticipant.updateMany({
      where: { conversationId, principalType: me.type, principalId: me.id },
      data: { lastReadAt: new Date() },
    });
    // The other side's "seen" mark changes.
    this.signal(conversation.participants, 'chat:read', { conversationId });
    return { ok: true };
  }

  /**
   * Delete one of the caller's own messages. The row stays as a visible
   * "message deleted" trace; its text and files are removed for good.
   */
  async deleteMessage(principal: AuthenticatedPrincipal, messageId: string) {
    const me = partyOf(principal);
    const message = await this.prisma.chatMessage.findFirst({
      where: { tenantId: principal.tenantId, id: messageId },
      include: {
        attachments: { select: { id: true, storageKey: true } },
        conversation: {
          select: {
            participants: {
              select: { principalType: true, principalId: true },
            },
          },
        },
      },
    });
    if (
      !message ||
      message.senderType !== me.type ||
      message.senderId !== me.id
    ) {
      throw new NotFoundException('الرسالة غير موجودة - Message not found');
    }
    if (message.deletedAt) return { ok: true };

    await this.prisma.$transaction([
      this.prisma.chatAttachment.deleteMany({ where: { messageId } }),
      this.prisma.chatMessage.update({
        where: { id: messageId },
        data: { body: null, deletedAt: new Date() },
      }),
    ]);
    for (const attachment of message.attachments) {
      await this.removeObject(principal.tenantId, attachment.storageKey);
    }

    await this.audit.log({
      tenantId: principal.tenantId,
      action: 'CHAT_MESSAGE_DELETED',
      category: 'CHAT',
      actorType: me.type,
      actorId: me.id,
      actorName: principal.fullName,
      entityType: 'ChatMessage',
      entityId: messageId,
      metadata: {
        conversationId: message.conversationId,
        files: message.attachments.length,
      },
    });

    this.signal(message.conversation.participants, 'chat:message', {
      conversationId: message.conversationId,
    });
    return { ok: true };
  }

  /** A file, for a participant only. Every read is audited. */
  async attachment(principal: AuthenticatedPrincipal, attachmentId: string) {
    const me = partyOf(principal);
    const attachment = await this.prisma.chatAttachment.findFirst({
      where: { tenantId: principal.tenantId, id: attachmentId },
      include: {
        message: {
          select: {
            conversationId: true,
            conversation: {
              select: {
                participants: {
                  select: { principalType: true, principalId: true },
                },
              },
            },
          },
        },
      },
    });
    const isParticipant = attachment?.message.conversation.participants.some(
      (p) => p.principalType === me.type && p.principalId === me.id,
    );
    if (!attachment || !isParticipant) {
      throw new NotFoundException('الملف غير موجود - File not found');
    }

    const buffer = await this.storage.getObject(
      principal.tenantId,
      attachment.storageKey,
    );

    await this.audit.log({
      tenantId: principal.tenantId,
      action: 'CHAT_FILE_DOWNLOADED',
      category: 'CHAT',
      actorType: me.type,
      actorId: me.id,
      actorName: principal.fullName,
      entityType: 'ChatAttachment',
      entityId: attachment.id,
      entityLabel: attachment.fileName,
      metadata: { conversationId: attachment.message.conversationId },
    });

    return {
      buffer,
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
    };
  }

  /** Total unread across the caller's conversations, for the launcher badge. */
  async unreadTotal(principal: AuthenticatedPrincipal) {
    const me = partyOf(principal);
    const mine = await this.prisma.chatParticipant.findMany({
      where: {
        tenantId: principal.tenantId,
        principalType: me.type,
        principalId: me.id,
      },
      select: { conversationId: true, lastReadAt: true },
    });
    const counts = await Promise.all(
      mine.map((row) => this.unreadIn(row.conversationId, me, row.lastReadAt)),
    );
    return { unread: counts.reduce((sum, count) => sum + count, 0) };
  }

  // ── Retention ───────────────────────────────────────────────────────────

  async settings(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    return {
      retentionDays: retentionDaysFrom(tenant.settings),
      minRetentionDays: MIN_RETENTION_DAYS,
      maxRetentionDays: MAX_RETENTION_DAYS,
    };
  }

  async updateSettings(
    tenantId: string,
    principal: AuthenticatedPrincipal,
    retentionDays: number,
  ) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    const before = retentionDaysFrom(tenant.settings);
    const after = retentionDaysFrom({ chatRetentionDays: retentionDays });
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: {
          ...((tenant.settings ?? {}) as Record<string, unknown>),
          chatRetentionDays: after,
        },
      },
    });
    await this.audit.log({
      tenantId,
      action: 'CHAT_RETENTION_UPDATED',
      category: 'CHAT',
      severity: 'NOTICE',
      actorType: principal.principalType,
      actorId: principal.id,
      actorName: principal.fullName,
      oldValue: { retentionDays: before },
      newValue: { retentionDays: after },
    });
    return this.settings(tenantId);
  }

  /**
   * Remove messages older than each company's retention, with their files.
   * Runs from the nightly sweep, as the system; returns how many went.
   */
  async pruneExpired(): Promise<number> {
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true, settings: true },
    });
    let removed = 0;

    for (const tenant of tenants) {
      const cutoff = new Date(
        Date.now() - retentionDaysFrom(tenant.settings) * 86_400_000,
      );
      // In batches, so a first run over years of history stays gentle.
      for (;;) {
        const old = await this.prisma.chatMessage.findMany({
          where: { tenantId: tenant.id, createdAt: { lt: cutoff } },
          select: {
            id: true,
            attachments: { select: { storageKey: true } },
          },
          take: 500,
        });
        if (old.length === 0) break;

        for (const message of old) {
          for (const attachment of message.attachments) {
            await this.removeObject(tenant.id, attachment.storageKey);
          }
        }
        const result = await this.prisma.chatMessage.deleteMany({
          where: { id: { in: old.map((message) => message.id) } },
        });
        removed += result.count;
        if (old.length < 500) break;
      }
    }
    return removed;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /** The conversation, if the caller is in it; otherwise 404. */
  private async loadMine(
    principal: AuthenticatedPrincipal,
    conversationId: string,
  ) {
    const me = partyOf(principal);
    const conversation = await this.prisma.chatConversation.findFirst({
      where: {
        tenantId: principal.tenantId,
        id: conversationId,
        participants: {
          some: { principalType: me.type, principalId: me.id },
        },
      },
      select: {
        id: true,
        participants: {
          select: { principalType: true, principalId: true, lastReadAt: true },
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException(
        'المحادثة غير موجودة - Conversation not found',
      );
    }
    return conversation;
  }

  private async assertExists(tenantId: string, party: ChatParty) {
    const found =
      party.type === PrincipalType.INVESTIGATOR
        ? await this.prisma.investigator.findFirst({
            where: { tenantId, id: party.id, deletedAt: null },
            select: { id: true },
          })
        : await this.prisma.user.findFirst({
            where: { tenantId, id: party.id, deletedAt: null },
            select: { id: true },
          });
    if (!found) {
      throw new NotFoundException('المستخدم غير موجود - Person not found');
    }
  }

  private unreadIn(
    conversationId: string,
    me: ChatParty,
    lastReadAt: Date | null,
  ) {
    return this.prisma.chatMessage.count({
      where: {
        conversationId,
        deletedAt: null,
        NOT: { senderType: me.type, senderId: me.id },
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    });
  }

  /** Current names, read live so a renamed person shows their new name. */
  private async namesFor(
    tenantId: string,
    parties: { principalType: PrincipalType; principalId: string }[],
  ) {
    const userIds = parties
      .filter((p) => p.principalType === PrincipalType.WEB_USER)
      .map((p) => p.principalId);
    const investigatorIds = parties
      .filter((p) => p.principalType === PrincipalType.INVESTIGATOR)
      .map((p) => p.principalId);

    const [users, investigators] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({
            where: { tenantId, id: { in: userIds } },
            select: {
              id: true,
              fullName: true,
              role: { select: { nameAr: true, nameEn: true } },
            },
          })
        : [],
      investigatorIds.length
        ? this.prisma.investigator.findMany({
            where: { tenantId, id: { in: investigatorIds } },
            select: { id: true, fullName: true, employeeCode: true },
          })
        : [],
    ]);

    const map = new Map<
      string,
      { name: string; roleAr: string | null; roleEn: string | null }
    >();
    for (const user of users) {
      map.set(`${PrincipalType.WEB_USER}:${user.id}`, {
        name: user.fullName,
        roleAr: user.role?.nameAr ?? null,
        roleEn: user.role?.nameEn ?? null,
      });
    }
    for (const investigator of investigators) {
      map.set(`${PrincipalType.INVESTIGATOR}:${investigator.id}`, {
        name: investigator.fullName,
        roleAr: `باحث ميداني · ${investigator.employeeCode}`,
        roleEn: `Field investigator · ${investigator.employeeCode}`,
      });
    }
    return map;
  }

  private toDto(row: MessageRow, me: ChatParty) {
    return {
      id: row.id,
      conversationId: row.conversationId,
      mine: row.senderType === me.type && row.senderId === me.id,
      body: row.deletedAt ? null : row.body,
      deleted: Boolean(row.deletedAt),
      createdAt: row.createdAt,
      attachments: row.deletedAt ? [] : row.attachments,
    };
  }

  private signal(
    participants: { principalType: PrincipalType; principalId: string }[],
    event: string,
    payload: Record<string, unknown>,
  ) {
    for (const participant of participants) {
      this.realtime.emitToPrincipal(participant.principalId, event, payload);
    }
  }

  private async removeObject(tenantId: string, key: string) {
    try {
      await this.storage.deleteObject(tenantId, key);
    } catch (error) {
      this.logger.warn(`Could not delete ${key}: ${String(error)}`);
    }
  }
}

function partyOf(principal: AuthenticatedPrincipal): ChatParty {
  return { type: principal.principalType, id: principal.id };
}
