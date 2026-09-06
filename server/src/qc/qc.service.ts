import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvestigationStatus,
  Prisma,
  QcDecision,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InvestigationsService } from '../investigations/investigations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paginate } from '../common/interfaces/api.interface';
import { STATUS_GROUPS } from '../investigations/case-status.machine';
import {
  QcDecisionDto,
  QcQueueQueryDto,
  UpsertRejectionReasonDto,
} from './dto/qc.dto';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Quality control.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  QC IS A CONTROL, WHICH MEANS THE REVIEWER CANNOT ALTER WHAT THEY REVIEW.
 *  The QC role holds no permission to edit a case, delete evidence or reassign
 *  work — see `system-roles.ts` — and the state machine refuses a QC decision
 *  from an investigator. A reviewer who can change the thing they are signing
 *  off on is not performing a control.
 *
 *  EVERY PASS IS A ROW. A case that goes round three times has three
 *  `QcReview` rows, each pinned to the submission attempt it judged. Nothing is
 *  updated in place, so "was this rejected before?" is answerable a year later,
 *  and a reviewer cannot quietly revise a verdict after the fact.
 *
 *  REJECTION REASONS ARE CONFIGURABLE ROWS, not an enum. A tenant that keeps
 *  seeing a particular failure adds a reason for it and can then count it —
 *  which is the entire point of structured reasons over free text.
 */
@Injectable()
export class QcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly investigations: InvestigationsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  The queue
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Cases waiting for review.
   *
   * Ordered oldest-submitted first by default, so the queue is a queue: a
   * reviewer working from the top is working the case that has been waiting
   * longest, which is what keeps the QC leg of the SLA honest.
   */
  async queue(tenantId: string, query: QcQueueQueryDto) {
    const statuses = query.status
      ? [query.status]
      : [InvestigationStatus.QC_PENDING];

    const where: Prisma.InvestigationWhereInput = {
      tenantId,
      deletedAt: null,
      status: { in: statuses },
      ...(query.investigationTypeId
        ? { investigationTypeId: query.investigationTypeId }
        : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.investigatorId ? { investigatorId: query.investigatorId } : {}),
      ...(query.search
        ? {
            OR: [
              { caseNumber: { contains: query.search, mode: 'insensitive' } },
              {
                customer: {
                  is: {
                    fullName: { contains: query.search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.investigation.findMany({
        where,
        include: {
          customer: { select: { id: true, fullName: true, mobile: true } },
          product: {
            select: { id: true, code: true, nameAr: true, nameEn: true },
          },
          investigationType: {
            select: { id: true, code: true, nameAr: true, nameEn: true },
          },
          investigator: {
            select: { id: true, fullName: true, employeeCode: true },
          },
          governorate: { select: { id: true, nameAr: true, nameEn: true } },
          _count: { select: { mediaAssets: true, qcReviews: true } },
        },
        orderBy: query.orderBy(
          ['submittedAt', 'dueAt', 'priority', 'reworkCount'],
          'submittedAt',
        ),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.investigation.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.limit);
  }

  /**
   * Everything a reviewer needs on one screen: answers, evidence, GPS, the
   * automatic checks and the history of previous verdicts.
   *
   * One call rather than six, because this screen is always rendered whole and
   * a reviewer waiting on six round trips reviews fewer cases.
   */
  async reviewPacket(tenantId: string, investigationId: string) {
    const investigation = await this.prisma.investigation.findFirst({
      where: { tenantId, id: investigationId, deletedAt: null },
      include: {
        customer: true,
        product: true,
        investigationType: true,
        investigator: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            phone: true,
            qualityScore: true,
          },
        },
        governorate: { select: { id: true, nameAr: true, nameEn: true } },
        city: { select: { id: true, nameAr: true, nameEn: true } },
        district: { select: { id: true, nameAr: true, nameEn: true } },
      },
    });

    if (!investigation) {
      throw new NotFoundException(
        'التحقيق غير موجود - Investigation not found',
      );
    }

    const [submission, previousSubmissions, media, gps, reviews] =
      await Promise.all([
        this.prisma.formSubmission.findFirst({
          where: {
            tenantId,
            investigationId,
            status: SubmissionStatus.SUBMITTED,
          },
          include: { formVersion: true },
          orderBy: { attempt: 'desc' },
        }),
        this.prisma.formSubmission.findMany({
          where: {
            tenantId,
            investigationId,
            status: SubmissionStatus.SUPERSEDED,
          },
          select: {
            id: true,
            attempt: true,
            answers: true,
            submittedAt: true,
            autoValidation: true,
          },
          orderBy: { attempt: 'desc' },
        }),
        this.prisma.mediaAsset.findMany({
          where: { tenantId, investigationId, deletedAt: null },
          include: {
            category: {
              select: { id: true, code: true, nameAr: true, nameEn: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.gpsEvent.findMany({
          where: { tenantId, investigationId },
          orderBy: { recordedAt: 'asc' },
        }),
        this.prisma.qcReview.findMany({
          where: { tenantId, investigationId },
          include: {
            reviewer: { select: { id: true, fullName: true } },
            reasons: { include: { reason: true } },
          },
          orderBy: { reviewedAt: 'desc' },
        }),
      ]);

    return {
      investigation,
      submission,
      previousSubmissions,
      media: media.map((asset) => ({
        ...asset,
        captureLat: asset.captureLat ? Number(asset.captureLat) : null,
        captureLng: asset.captureLng ? Number(asset.captureLng) : null,
      })),
      gpsEvents: gps.map((event) => ({
        ...event,
        lat: Number(event.lat),
        lng: Number(event.lng),
        accuracyM: event.accuracyM ? Number(event.accuracyM) : null,
      })),
      previousReviews: reviews,
      autoValidation: submission?.autoValidation ?? null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  The decision
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Approve, reject or send back for rework.
   *
   * All three go through one method because they share everything except the
   * target status: the review row, the reason rows, the case transition, the
   * notification and the audit entry. Three near-identical methods would drift.
   */
  async decide(
    tenantId: string,
    reviewer: AuthenticatedUser,
    investigationId: string,
    dto: QcDecisionDto,
  ) {
    const investigation = await this.prisma.investigation.findFirst({
      where: { tenantId, id: investigationId, deletedAt: null },
      select: {
        id: true,
        caseNumber: true,
        status: true,
        investigatorId: true,
        coordinatorId: true,
        reworkCount: true,
      },
    });

    if (!investigation) {
      throw new NotFoundException(
        'التحقيق غير موجود - Investigation not found',
      );
    }

    if (investigation.status !== InvestigationStatus.QC_PENDING) {
      throw new BadRequestException(
        `التحقيق ليس في انتظار المراجعة (${investigation.status}) - ` +
          `This case is not awaiting QC (it is ${investigation.status})`,
      );
    }

    // A rejection has to say why. A structured reason, not just prose: the
    // rejection-rate report is only meaningful if reasons are countable.
    if (dto.decision !== QcDecision.APPROVED) {
      if (!dto.reasonIds?.length && !dto.comment?.trim()) {
        throw new BadRequestException(
          'يجب تحديد سبب الرفض - A rejection must state at least one reason',
        );
      }
    }

    if (dto.reasonIds?.length) {
      const found = await this.prisma.qcRejectionReason.findMany({
        where: { tenantId, id: { in: dto.reasonIds }, isActive: true },
        select: { id: true, code: true, needsNote: true },
      });

      if (found.length !== dto.reasonIds.length) {
        throw new BadRequestException(
          'أحد أسباب الرفض غير موجود - One of the rejection reasons does not exist',
        );
      }

      const needsNote = found.filter((r) => r.needsNote);
      if (needsNote.length > 0 && !dto.comment?.trim()) {
        throw new BadRequestException(
          `السبب "${needsNote[0].code}" يتطلب توضيحًا - ` +
            `Reason "${needsNote[0].code}" requires a note`,
        );
      }
    }

    const submission = await this.prisma.formSubmission.findFirst({
      where: { tenantId, investigationId, status: SubmissionStatus.SUBMITTED },
      orderBy: { attempt: 'desc' },
      select: { id: true, attempt: true },
    });

    const review = await this.prisma.$transaction(async (tx) => {
      const created = await tx.qcReview.create({
        data: {
          tenantId,
          investigationId,
          submissionId: submission?.id,
          attempt: submission?.attempt ?? 1,
          reviewerId: reviewer.id,
          decision: dto.decision,
          comment: dto.comment,
          fieldRemarks: (dto.fieldRemarks ?? undefined) as never,
          score: dto.score,
        },
      });

      if (dto.reasonIds?.length) {
        await tx.qcReviewReason.createMany({
          data: dto.reasonIds.map((reasonId) => ({
            reviewId: created.id,
            reasonId,
            note: dto.comment,
          })),
        });
      }

      return created;
    });

    const nextStatus =
      dto.decision === QcDecision.APPROVED
        ? InvestigationStatus.QC_APPROVED
        : dto.decision === QcDecision.REWORK
          ? InvestigationStatus.REWORK
          : InvestigationStatus.QC_REJECTED;

    await this.investigations.transition(tenantId, investigationId, reviewer, {
      status: nextStatus,
      reason: dto.comment ?? `QC decision: ${dto.decision}`,
    });

    // The investigator's rolling counters, which the assignment ranking reads.
    // Denormalised because ranking ninety candidates cannot afford an aggregate
    // per row; kept in step here, at the one moment they change.
    if (investigation.investigatorId) {
      await this.prisma.investigator.update({
        where: { id: investigation.investigatorId },
        data:
          dto.decision === QcDecision.APPROVED
            ? { completedCount: { increment: 1 } }
            : { rejectedCount: { increment: 1 } },
      });
    }

    await this.audit.log({
      tenantId,
      action:
        dto.decision === QcDecision.APPROVED
          ? 'CASE_APPROVED'
          : dto.decision === QcDecision.REWORK
            ? 'CASE_REWORK_REQUESTED'
            : 'CASE_REJECTED',
      category: 'QC',
      severity: dto.decision === QcDecision.APPROVED ? 'INFO' : 'NOTICE',
      entityType: 'Investigation',
      entityId: investigationId,
      entityLabel: investigation.caseNumber,
      newValue: {
        decision: dto.decision,
        reasonIds: dto.reasonIds,
        attempt: submission?.attempt,
      },
      metadata: { comment: dto.comment },
    });

    if (investigation.coordinatorId) {
      await this.notifications.notifyUser(
        tenantId,
        investigation.coordinatorId,
        {
          type:
            dto.decision === QcDecision.APPROVED
              ? 'QC_APPROVED'
              : 'QC_REJECTED',
          titleAr:
            dto.decision === QcDecision.APPROVED
              ? 'اعتماد الجودة'
              : 'رفض من مراجعة الجودة',
          titleEn:
            dto.decision === QcDecision.APPROVED
              ? 'QC approved'
              : 'QC rejected',
          bodyAr: `التحقيق ${investigation.caseNumber}: ${dto.comment ?? dto.decision}`,
          bodyEn: `${investigation.caseNumber}: ${dto.comment ?? dto.decision}`,
          entityType: 'Investigation',
          entityId: investigationId,
          link: `/investigations/${investigationId}`,
          priority: dto.decision === QcDecision.APPROVED ? 'NORMAL' : 'HIGH',
        },
      );
    }

    return { review, status: nextStatus };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Rejection reasons
  // ─────────────────────────────────────────────────────────────────────────

  async listReasons(tenantId: string, activeOnly = false) {
    return this.prisma.qcRejectionReason.findMany({
      where: { tenantId, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
  }

  async upsertReason(
    tenantId: string,
    dto: UpsertRejectionReasonDto,
    id?: string,
  ) {
    if (id) {
      const existing = await this.prisma.qcRejectionReason.findFirst({
        where: { tenantId, id },
      });
      if (!existing) {
        throw new NotFoundException('السبب غير موجود - Reason not found');
      }
      return this.prisma.qcRejectionReason.update({
        where: { id },
        data: { ...dto, code: existing.code },
      });
    }

    const clash = await this.prisma.qcRejectionReason.findFirst({
      where: { tenantId, code: dto.code },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException(
        'كود السبب مستخدم بالفعل - Reason code is already in use',
      );
    }

    return this.prisma.qcRejectionReason.create({
      data: { tenantId, ...dto },
    });
  }

  /**
   * Deactivate rather than delete once used — historical reviews name it, and
   * the rejection-reason report would lose those rows.
   */
  async removeReason(tenantId: string, id: string) {
    const reason = await this.prisma.qcRejectionReason.findFirst({
      where: { tenantId, id },
      include: { _count: { select: { reviews: true } } },
    });
    if (!reason) {
      throw new NotFoundException('السبب غير موجود - Reason not found');
    }

    if (reason._count.reviews > 0) {
      await this.prisma.qcRejectionReason.update({
        where: { id },
        data: { isActive: false },
      });
      return {
        deleted: false,
        deactivated: true,
        message:
          `السبب مستخدم في ${reason._count.reviews} مراجعة، تم تعطيله - ` +
          `Used by ${reason._count.reviews} review(s); deactivated instead`,
      };
    }

    await this.prisma.qcRejectionReason.delete({ where: { id } });
    return { deleted: true, deactivated: false };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Statistics
  // ─────────────────────────────────────────────────────────────────────────

  /** Rejection rate and the reasons behind it — the QC quality report. */
  async statistics(tenantId: string, from?: Date, to?: Date) {
    const period =
      from || to
        ? {
            reviewedAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {};

    const [byDecision, byReason, pending] = await Promise.all([
      this.prisma.qcReview.groupBy({
        by: ['decision'],
        where: { tenantId, ...period },
        _count: { _all: true },
      }),
      this.prisma.qcReviewReason.findMany({
        where: { review: { tenantId, ...period } },
        select: {
          reason: {
            select: { id: true, code: true, nameAr: true, nameEn: true },
          },
        },
      }),
      this.prisma.investigation.count({
        where: {
          tenantId,
          deletedAt: null,
          status: { in: [...STATUS_GROUPS.QC] },
        },
      }),
    ]);

    const counts = Object.fromEntries(
      byDecision.map((row) => [row.decision, row._count._all]),
    ) as Record<QcDecision, number>;

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const approved = counts.APPROVED ?? 0;

    const reasonTally = new Map<
      string,
      { code: string; nameAr: string; nameEn: string; count: number }
    >();
    for (const row of byReason) {
      const key = row.reason.id;
      const current = reasonTally.get(key);
      if (current) current.count++;
      else
        reasonTally.set(key, {
          code: row.reason.code,
          nameAr: row.reason.nameAr,
          nameEn: row.reason.nameEn,
          count: 1,
        });
    }

    return {
      period: { from: from ?? null, to: to ?? null },
      reviewed: total,
      approved,
      rejected: counts.REJECTED ?? 0,
      rework: counts.REWORK ?? 0,
      approvalRate: total > 0 ? Math.round((approved / total) * 100) : null,
      rejectionRate:
        total > 0 ? Math.round(((total - approved) / total) * 100) : null,
      pendingReview: pending,
      topReasons: [...reasonTally.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }
}
