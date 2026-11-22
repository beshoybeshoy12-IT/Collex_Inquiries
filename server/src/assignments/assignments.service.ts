import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentMethod,
  AssignmentStatus,
  Investigation,
  InvestigationStatus,
  PrincipalType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SlaPolicyService } from '../investigations/sla-policy.service';
import {
  assertTransition,
  OPEN_FOR_INVESTIGATOR,
} from '../investigations/case-status.machine';
import {
  AssignDto,
  BulkAssignDto,
  ReassignDto,
  RespondToAssignmentDto,
  SuggestQueryDto,
} from './dto/assignment.dto';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';
import { rankCandidates, CandidateInvestigator } from './auto-assign.engine';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Assignment.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The brief is emphatic that manual assignment by a coordinator is the
 *  business requirement and must work perfectly, and that nothing may be sent
 *  to an investigator outside that workflow. So:
 *
 *   - `assign` and `bulkAssign` are what the coordinator screen calls, and they
 *     are the only paths that create an `Assignment`.
 *   - `suggest` ranks candidates and returns them. It assigns nothing. The
 *     auto-assignment engine exists as a scoring function the coordinator can
 *     consult, not as a background process that hands work out on its own.
 *
 *  REASSIGNMENT DOES NOT EDIT. Moving a case to another investigator closes the
 *  old `Assignment` row and opens a new one linked to it. The chain is the
 *  history — which matters when a client asks why their case took four days and
 *  the honest answer is that it sat with someone who never accepted it.
 *
 *  EVERY ASSIGNMENT IS CHECKED, not merely recorded: the investigator must be
 *  active, in the right company, qualified for the type and product, cover the
 *  governorate, and have room. Skipping those turns the workload figures on the
 *  dashboard into fiction.
 */
@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly slaPolicies: SlaPolicyService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Eligibility
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Everything that makes an investigator a legal target for this case.
   *
   * Returns the reasons rather than a boolean, because "cannot assign" with no
   * explanation is the kind of message that makes a coordinator phone support.
   */
  private async eligibility(
    tenantId: string,
    investigatorId: string,
    investigation: Pick<
      Investigation,
      'id' | 'investigationTypeId' | 'productId' | 'governorateId' | 'cityId'
    >,
  ): Promise<{
    ok: boolean;
    reasons: string[];
    investigator: {
      id: string;
      fullName: string;
      maxOpenCases: number;
      openCases: number;
    } | null;
  }> {
    const investigator = await this.prisma.investigator.findFirst({
      where: { tenantId, id: investigatorId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        status: true,
        availability: true,
        governorateIds: true,
        cityIds: true,
        investigationTypeIds: true,
        productIds: true,
        maxOpenCases: true,
      },
    });

    if (!investigator) {
      return {
        ok: false,
        reasons: ['الباحث غير موجود - Investigator not found'],
        investigator: null,
      };
    }

    const reasons: string[] = [];

    if (investigator.status !== 'ACTIVE') {
      reasons.push(
        `الباحث غير مفعل (${investigator.status}) - Investigator is not active (${investigator.status})`,
      );
    }

    if (investigator.availability === 'ON_LEAVE') {
      reasons.push('الباحث في إجازة - Investigator is on leave');
    }

    // An empty qualification list means "no restriction". A tenant that has not
    // configured skills yet must not find every assignment refused.
    if (
      investigator.investigationTypeIds.length > 0 &&
      !investigator.investigationTypeIds.includes(
        investigation.investigationTypeId,
      )
    ) {
      reasons.push(
        'الباحث غير مؤهل لهذا النوع من التحقيق - ' +
          'Investigator is not qualified for this investigation type',
      );
    }

    if (
      investigator.productIds.length > 0 &&
      !investigator.productIds.includes(investigation.productId)
    ) {
      reasons.push(
        'الباحث غير مؤهل لهذا المنتج - Investigator is not qualified for this product',
      );
    }

    if (
      investigation.governorateId &&
      investigator.governorateIds.length > 0 &&
      !investigator.governorateIds.includes(investigation.governorateId)
    ) {
      reasons.push(
        'المحافظة خارج نطاق تغطية الباحث - ' +
          'The governorate is outside this investigator’s coverage',
      );
    }

    const openCases = await this.prisma.investigation.count({
      where: {
        tenantId,
        investigatorId,
        deletedAt: null,
        status: { in: OPEN_FOR_INVESTIGATOR },
      },
    });

    if (openCases >= investigator.maxOpenCases) {
      reasons.push(
        `الباحث وصل للحد الأقصى (${openCases}/${investigator.maxOpenCases}) - ` +
          `Investigator is at capacity (${openCases}/${investigator.maxOpenCases})`,
      );
    }

    return {
      ok: reasons.length === 0,
      reasons,
      investigator: {
        id: investigator.id,
        fullName: investigator.fullName,
        maxOpenCases: investigator.maxOpenCases,
        openCases,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Assign
  // ─────────────────────────────────────────────────────────────────────────

  async assign(tenantId: string, user: AuthenticatedUser, dto: AssignDto) {
    const result = await this.assignOne(
      tenantId,
      user,
      dto.investigationId,
      dto.investigatorId,
      { method: AssignmentMethod.MANUAL, notes: dto.notes, force: dto.force },
    );

    if (!result.ok) {
      throw new BadRequestException({
        message: result.reasons.join(' • '),
        errorCode: 'INVESTIGATOR_NOT_ELIGIBLE',
        reasons: result.reasons,
      });
    }

    return result.assignment;
  }

  /**
   * Bulk assignment.
   *
   * Per-case rather than one transaction: a batch of forty where two
   * investigators are at capacity should assign thirty-eight and report the
   * two, not fail entirely. The response names every skipped case and why,
   * which is what the screen renders.
   */
  async bulkAssign(
    tenantId: string,
    user: AuthenticatedUser,
    dto: BulkAssignDto,
  ) {
    const assigned: { investigationId: string; assignmentId: string }[] = [];
    const skipped: { investigationId: string; reasons: string[] }[] = [];

    for (const investigationId of dto.investigationIds) {
      const result = await this.assignOne(
        tenantId,
        user,
        investigationId,
        dto.investigatorId,
        { method: AssignmentMethod.BULK, notes: dto.notes, force: dto.force },
      ).catch((error) => ({
        ok: false as const,
        reasons: [error?.message ?? 'Unexpected error'],
        assignment: null,
      }));

      if (result.ok && result.assignment) {
        assigned.push({
          investigationId,
          assignmentId: result.assignment.id,
        });
      } else {
        skipped.push({ investigationId, reasons: result.reasons });
      }
    }

    await this.audit.log({
      tenantId,
      action: 'CASE_BULK_ASSIGNED',
      category: 'ASSIGNMENT',
      severity: 'NOTICE',
      entityType: 'Investigator',
      entityId: dto.investigatorId,
      metadata: {
        requested: dto.investigationIds.length,
        assigned: assigned.length,
        skipped: skipped.length,
      },
    });

    return {
      assigned: assigned.length,
      skipped: skipped.length,
      details: { assigned, skipped },
    };
  }

  /** The shared body of every assignment path. */
  private async assignOne(
    tenantId: string,
    user: AuthenticatedUser,
    investigationId: string,
    investigatorId: string,
    options: {
      method: AssignmentMethod;
      notes?: string;
      reassignReason?: string;
      force?: boolean;
    },
  ): Promise<{
    ok: boolean;
    reasons: string[];
    assignment: { id: string } | null;
  }> {
    const investigation = await this.prisma.investigation.findFirst({
      where: { tenantId, id: investigationId, deletedAt: null },
      select: {
        id: true,
        caseNumber: true,
        status: true,
        investigatorId: true,
        investigationTypeId: true,
        productId: true,
        governorateId: true,
        cityId: true,
        priority: true,
        dueAt: true,
        formVersionId: true,
        investigationType: { select: { formTemplateId: true } },
      },
    });

    if (!investigation) {
      throw new NotFoundException(
        'التحقيق غير موجود - Investigation not found',
      );
    }

    const isReassign = Boolean(investigation.investigatorId);

    // The machine decides whether this case may be assigned at all. Reassigning
    // an ASSIGNED case is the ASSIGNED→ASSIGNED rule and needs a reason.
    const targetStatus = InvestigationStatus.ASSIGNED;
    assertTransition(
      investigation.status,
      targetStatus,
      PrincipalType.WEB_USER,
      options.reassignReason ?? (isReassign ? undefined : 'assignment'),
    );

    const eligibility = await this.eligibility(
      tenantId,
      investigatorId,
      investigation,
    );

    if (!eligibility.ok) {
      // `force` lets a supervisor override capacity and coverage — the real
      // world has days where somebody has to take a forty-first case. It is
      // recorded on the audit row so the override is visible afterwards.
      if (!options.force) {
        return { ok: false, reasons: eligibility.reasons, assignment: null };
      }
      this.logger.warn(
        `Assignment of ${investigation.caseNumber} to ${investigatorId} forced ` +
          `past: ${eligibility.reasons.join('; ')}`,
      );
    }

    // The offer expires after the acceptance window, which is what the stale
    // sweep and the escalation rules measure against.
    const policy = await this.slaPolicies.resolve(tenantId, {
      productId: investigation.productId,
      investigationTypeId: investigation.investigationTypeId,
      priority: investigation.priority,
    });
    const expiresAt = policy
      ? new Date(Date.now() + policy.acceptanceHours * 3_600_000)
      : null;

    // A case is assigned with the form version pinned. Editing the template
    // afterwards cannot change what this investigator is asked.
    //
    // Only the FIRST assignment pins. A case that already carries a form keeps
    // it through reassignment and rework: the office may have chosen that form
    // deliberately (a work form on a case whose type defaults to residence),
    // and re-pinning would also put a rework's second attempt on a different
    // version from its first.
    const formVersionId =
      !investigation.formVersionId &&
      investigation.investigationType.formTemplateId
      ? ((
          await this.prisma.formTemplate.findFirst({
            where: {
              tenantId,
              id: investigation.investigationType.formTemplateId,
            },
            select: { publishedVersionId: true },
          })
        )?.publishedVersionId ?? null)
      : null;

    const assignment = await this.prisma.$transaction(async (tx) => {
      let previousAssignmentId: string | undefined;

      if (isReassign) {
        const open = await tx.assignment.findFirst({
          where: {
            tenantId,
            investigationId,
            status: {
              in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED],
            },
          },
          orderBy: { assignedAt: 'desc' },
          select: { id: true },
        });

        if (open) {
          await tx.assignment.update({
            where: { id: open.id },
            data: {
              status: AssignmentStatus.REASSIGNED,
              reassignReason: options.reassignReason,
              closedAt: new Date(),
            },
          });
          previousAssignmentId = open.id;
        }
      }

      const created = await tx.assignment.create({
        data: {
          tenantId,
          investigationId,
          investigatorId,
          assignedById: user.id,
          status: AssignmentStatus.PENDING,
          method: options.method,
          previousAssignmentId,
          reassignReason: options.reassignReason,
          expiresAt,
          notes: options.notes,
        },
        select: { id: true },
      });

      await tx.investigation.update({
        where: { id: investigationId },
        data: {
          investigatorId,
          status: targetStatus,
          assignedAt: new Date(),
          // A reassignment restarts the acceptance clock: the new investigator
          // has not seen the case, so carrying the old stamp would show them as
          // already late.
          acceptedAt: null,
          coordinatorId:
            investigation.status === InvestigationStatus.READY_FOR_ASSIGNMENT
              ? user.id
              : undefined,
          ...(formVersionId ? { formVersionId } : {}),
        },
      });

      await tx.investigationStatusHistory.create({
        data: {
          tenantId,
          investigationId,
          fromStatus: investigation.status,
          toStatus: targetStatus,
          actorType: PrincipalType.WEB_USER,
          actorId: user.id,
          actorName: user.fullName,
          reason: options.reassignReason ?? 'Assigned to field investigator',
          metadata: {
            investigatorId,
            method: options.method,
            forced: Boolean(options.force && !eligibility.ok),
          },
        },
      });

      return created;
    });

    await this.audit.log({
      tenantId,
      action: isReassign ? 'CASE_REASSIGNED' : 'CASE_ASSIGNED',
      category: 'ASSIGNMENT',
      entityType: 'Investigation',
      entityId: investigationId,
      entityLabel: investigation.caseNumber,
      oldValue: { investigatorId: investigation.investigatorId },
      newValue: { investigatorId },
      metadata: {
        method: options.method,
        reason: options.reassignReason,
        forced: Boolean(options.force && !eligibility.ok),
        overrides:
          options.force && !eligibility.ok ? eligibility.reasons : undefined,
      },
    });

    await this.notifications.notifyInvestigator(tenantId, investigatorId, {
      type: isReassign ? 'CASE_REASSIGNED' : 'CASE_ASSIGNED',
      titleAr: 'تحقيق جديد',
      titleEn: 'New assignment',
      bodyAr: `تم إسناد التحقيق ${investigation.caseNumber} إليك`,
      bodyEn: `Investigation ${investigation.caseNumber} has been assigned to you`,
      entityType: 'Investigation',
      entityId: investigationId,
      link: `/investigations/${investigationId}`,
      priority: investigation.priority === 'URGENT' ? 'URGENT' : 'HIGH',
      channels: ['IN_APP', 'PUSH'],
    });

    this.realtime.emitToTenant(tenantId, 'assignment:created', {
      investigationId,
      investigatorId,
      caseNumber: investigation.caseNumber,
    });

    return { ok: true, reasons: [], assignment };
  }

  async reassign(tenantId: string, user: AuthenticatedUser, dto: ReassignDto) {
    const result = await this.assignOne(
      tenantId,
      user,
      dto.investigationId,
      dto.investigatorId,
      {
        method: AssignmentMethod.REASSIGN,
        reassignReason: dto.reason,
        force: dto.force,
      },
    );

    if (!result.ok) {
      throw new BadRequestException({
        message: result.reasons.join(' • '),
        errorCode: 'INVESTIGATOR_NOT_ELIGIBLE',
        reasons: result.reasons,
      });
    }

    return result.assignment;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  The investigator's side — what the mobile client calls
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Accept or decline.
   *
   * The case's own status moves through the state machine, which is what
   * enforces that only the *assigned* investigator can answer: the assignment
   * is looked up by investigator id, so a request naming somebody else's
   * assignment finds nothing.
   */
  async respond(
    tenantId: string,
    investigatorId: string,
    investigatorName: string,
    assignmentId: string,
    dto: RespondToAssignmentDto,
  ) {
    const assignment = await this.prisma.assignment.findFirst({
      where: {
        tenantId,
        id: assignmentId,
        investigatorId,
        status: AssignmentStatus.PENDING,
      },
      include: {
        investigation: {
          select: {
            id: true,
            caseNumber: true,
            status: true,
            coordinatorId: true,
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        'الإسناد غير موجود أو تم الرد عليه بالفعل - ' +
          'Assignment not found or already answered',
      );
    }

    const accepting = dto.accept;
    const nextStatus = accepting
      ? InvestigationStatus.ACCEPTED
      : InvestigationStatus.READY_FOR_ASSIGNMENT;

    assertTransition(
      assignment.investigation.status,
      nextStatus,
      PrincipalType.INVESTIGATOR,
      dto.reason,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.assignment.update({
        where: { id: assignmentId },
        data: {
          status: accepting
            ? AssignmentStatus.ACCEPTED
            : AssignmentStatus.REJECTED,
          respondedAt: new Date(),
          ...(accepting
            ? {}
            : { rejectReason: dto.reason, closedAt: new Date() }),
        },
      });

      await tx.investigation.update({
        where: { id: assignment.investigationId },
        data: {
          status: nextStatus,
          ...(accepting
            ? { acceptedAt: new Date() }
            : // Declining hands the case back to the queue, so it must stop
              // being attributed to this investigator or it stays invisible in
              // the unassigned list.
              { investigatorId: null, assignedAt: null }),
        },
      });

      await tx.investigationStatusHistory.create({
        data: {
          tenantId,
          investigationId: assignment.investigationId,
          fromStatus: assignment.investigation.status,
          toStatus: nextStatus,
          actorType: PrincipalType.INVESTIGATOR,
          actorId: investigatorId,
          actorName: investigatorName,
          reason: dto.reason,
        },
      });
    });

    await this.audit.log({
      tenantId,
      action: accepting ? 'ASSIGNMENT_ACCEPTED' : 'ASSIGNMENT_REJECTED',
      category: 'ASSIGNMENT',
      severity: accepting ? 'INFO' : 'NOTICE',
      actorType: PrincipalType.INVESTIGATOR,
      actorId: investigatorId,
      actorName: investigatorName,
      entityType: 'Investigation',
      entityId: assignment.investigationId,
      entityLabel: assignment.investigation.caseNumber,
      metadata: { reason: dto.reason },
    });

    if (assignment.investigation.coordinatorId) {
      await this.notifications.notifyUser(
        tenantId,
        assignment.investigation.coordinatorId,
        {
          type: accepting ? 'CASE_ACCEPTED' : 'CASE_REJECTED_BY_INVESTIGATOR',
          titleAr: accepting ? 'تم قبول الإسناد' : 'تم رفض الإسناد',
          titleEn: accepting ? 'Assignment accepted' : 'Assignment declined',
          bodyAr: accepting
            ? `قبل ${investigatorName} التحقيق ${assignment.investigation.caseNumber}`
            : `رفض ${investigatorName} التحقيق ${assignment.investigation.caseNumber}: ${dto.reason ?? ''}`,
          bodyEn: accepting
            ? `${investigatorName} accepted ${assignment.investigation.caseNumber}`
            : `${investigatorName} declined ${assignment.investigation.caseNumber}: ${dto.reason ?? ''}`,
          entityType: 'Investigation',
          entityId: assignment.investigationId,
          link: `/investigations/${assignment.investigationId}`,
          priority: accepting ? 'NORMAL' : 'HIGH',
        },
      );
    }

    this.realtime.emitToTenant(tenantId, 'assignment:answered', {
      investigationId: assignment.investigationId,
      accepted: accepting,
    });

    return { success: true, accepted: accepting };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Reads
  // ─────────────────────────────────────────────────────────────────────────

  /** The full assignment chain for one case — the Assignment History tab. */
  async historyFor(tenantId: string, investigationId: string) {
    return this.prisma.assignment.findMany({
      where: { tenantId, investigationId },
      orderBy: { assignedAt: 'desc' },
      include: {
        investigator: {
          select: { id: true, fullName: true, employeeCode: true, phone: true },
        },
        assignedBy: { select: { id: true, fullName: true } },
      },
    });
  }

  /** What one investigator currently holds — the mobile home screen. */
  async forInvestigator(
    tenantId: string,
    investigatorId: string,
    statuses?: AssignmentStatus[],
  ) {
    return this.prisma.assignment.findMany({
      where: {
        tenantId,
        investigatorId,
        ...(statuses?.length
          ? { status: { in: statuses } }
          : {
              status: {
                in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED],
              },
            }),
      },
      orderBy: [{ assignedAt: 'desc' }],
      include: {
        investigation: {
          include: {
            customer: {
              select: { id: true, fullName: true, mobile: true },
            },
            investigationType: {
              select: { id: true, code: true, nameAr: true, nameEn: true },
            },
            product: {
              select: { id: true, code: true, nameAr: true, nameEn: true },
            },
            governorate: { select: { id: true, nameAr: true, nameEn: true } },
            city: { select: { id: true, nameAr: true, nameEn: true } },
          },
        },
      },
    });
  }

  /**
   * Rank investigators for a case, without assigning anybody.
   *
   * This is the whole of the "auto assignment engine" as shipped, and that is
   * deliberate — the brief says manual coordinator assignment must always be
   * supported and that automatic assignment must not be forced. Scoring is
   * useful to a coordinator staring at ninety names; deciding for them is not
   * what was asked for.
   */
  async suggest(tenantId: string, query: SuggestQueryDto) {
    const investigation = await this.prisma.investigation.findFirst({
      where: { tenantId, id: query.investigationId, deletedAt: null },
      select: {
        id: true,
        investigationTypeId: true,
        productId: true,
        governorateId: true,
        cityId: true,
        districtId: true,
        areaId: true,
        priority: true,
        targetLat: true,
        targetLng: true,
      },
    });

    if (!investigation) {
      throw new NotFoundException(
        'التحقيق غير موجود - Investigation not found',
      );
    }

    const investigators = await this.prisma.investigator.findMany({
      where: { tenantId, status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        availability: true,
        governorateIds: true,
        cityIds: true,
        districtIds: true,
        areaIds: true,
        investigationTypeIds: true,
        productIds: true,
        maxOpenCases: true,
        qualityScore: true,
        avgTatMinutes: true,
        completedCount: true,
        rejectedCount: true,
        lastLat: true,
        lastLng: true,
      },
    });

    // One grouped count instead of one query per investigator — this list can
    // be a hundred people and the screen is expected to be instant.
    const workloads = await this.prisma.investigation.groupBy({
      by: ['investigatorId'],
      where: {
        tenantId,
        deletedAt: null,
        status: { in: OPEN_FOR_INVESTIGATOR },
        investigatorId: { in: investigators.map((i) => i.id) },
      },
      _count: { _all: true },
    });

    const openByInvestigator = new Map(
      workloads.map((row) => [row.investigatorId, row._count._all]),
    );

    const candidates: CandidateInvestigator[] = investigators.map((i) => ({
      id: i.id,
      fullName: i.fullName,
      employeeCode: i.employeeCode,
      availability: i.availability,
      governorateIds: i.governorateIds,
      cityIds: i.cityIds,
      districtIds: i.districtIds,
      areaIds: i.areaIds,
      investigationTypeIds: i.investigationTypeIds,
      productIds: i.productIds,
      maxOpenCases: i.maxOpenCases,
      openCases: openByInvestigator.get(i.id) ?? 0,
      qualityScore: i.qualityScore ? Number(i.qualityScore) : null,
      avgTatMinutes: i.avgTatMinutes,
      completedCount: i.completedCount,
      rejectedCount: i.rejectedCount,
      lastLat: i.lastLat ? Number(i.lastLat) : null,
      lastLng: i.lastLng ? Number(i.lastLng) : null,
    }));

    return rankCandidates(candidates, {
      investigationTypeId: investigation.investigationTypeId,
      productId: investigation.productId,
      governorateId: investigation.governorateId,
      cityId: investigation.cityId,
      districtId: investigation.districtId,
      areaId: investigation.areaId,
      targetLat: investigation.targetLat
        ? Number(investigation.targetLat)
        : null,
      targetLng: investigation.targetLng
        ? Number(investigation.targetLng)
        : null,
    }).slice(0, query.limit ?? 10);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Housekeeping
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Expire offers nobody answered.
   *
   * The case goes back to the unassigned queue rather than staying attached to
   * an investigator who never looked at it — leaving it assigned is how a case
   * quietly misses its SLA with nobody's name against it.
   *
   * Called by the scheduled sweep, which runs across tenants.
   */
  async expireStaleOffers(): Promise<number> {
    const stale = await this.prisma.assignment.findMany({
      where: {
        status: AssignmentStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      select: {
        id: true,
        tenantId: true,
        investigationId: true,
        investigatorId: true,
        investigation: {
          select: { status: true, caseNumber: true, coordinatorId: true },
        },
      },
      take: 500,
    });

    let expired = 0;

    for (const offer of stale) {
      // Only a case still sitting in ASSIGNED is genuinely stale — anything
      // further along was accepted between the query and now.
      if (offer.investigation.status !== InvestigationStatus.ASSIGNED) continue;

      await this.prisma
        .$transaction(async (tx) => {
          await tx.assignment.update({
            where: { id: offer.id },
            data: { status: AssignmentStatus.EXPIRED, closedAt: new Date() },
          });
          await tx.investigation.update({
            where: { id: offer.investigationId },
            data: {
              status: InvestigationStatus.READY_FOR_ASSIGNMENT,
              investigatorId: null,
              assignedAt: null,
            },
          });
          await tx.investigationStatusHistory.create({
            data: {
              tenantId: offer.tenantId,
              investigationId: offer.investigationId,
              fromStatus: InvestigationStatus.ASSIGNED,
              toStatus: InvestigationStatus.READY_FOR_ASSIGNMENT,
              actorType: null,
              actorName: 'system',
              reason: 'Assignment offer expired without a response',
            },
          });
        })
        .then(() => {
          expired++;
        })
        .catch((error) =>
          this.logger.warn(
            `Could not expire assignment ${offer.id}: ${String(error)}`,
          ),
        );

      if (offer.investigation.coordinatorId) {
        await this.notifications.notifyUser(
          offer.tenantId,
          offer.investigation.coordinatorId,
          {
            type: 'ESCALATION',
            titleAr: 'انتهت مهلة قبول الإسناد',
            titleEn: 'Assignment offer expired',
            bodyAr: `لم يتم قبول التحقيق ${offer.investigation.caseNumber} وتمت إعادته لقائمة الانتظار`,
            bodyEn: `${offer.investigation.caseNumber} was not accepted and has returned to the queue`,
            entityType: 'Investigation',
            entityId: offer.investigationId,
            priority: 'HIGH',
          },
        );
      }
    }

    if (expired > 0) {
      this.logger.log(`Expired ${expired} unanswered assignment offer(s)`);
    }
    return expired;
  }

  /** Workload per investigator, for the assignment screen's sidebar. */
  async workloadSummary(tenantId: string) {
    const [investigators, workloads] = await Promise.all([
      this.prisma.investigator.findMany({
        where: { tenantId, status: 'ACTIVE', deletedAt: null },
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          availability: true,
          maxOpenCases: true,
          maxDailyCases: true,
          qualityScore: true,
          governorateIds: true,
        },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.investigation.groupBy({
        by: ['investigatorId', 'status'],
        where: {
          tenantId,
          deletedAt: null,
          status: { in: OPEN_FOR_INVESTIGATOR },
        },
        _count: { _all: true },
      }),
    ]);

    const byInvestigator = new Map<string, Record<string, number>>();
    for (const row of workloads) {
      if (!row.investigatorId) continue;
      const bucket = byInvestigator.get(row.investigatorId) ?? {};
      bucket[row.status] = row._count._all;
      byInvestigator.set(row.investigatorId, bucket);
    }

    return investigators.map((investigator) => {
      const byStatus = byInvestigator.get(investigator.id) ?? {};
      const openCases = Object.values(byStatus).reduce((a, b) => a + b, 0);
      return {
        ...investigator,
        qualityScore: investigator.qualityScore
          ? Number(investigator.qualityScore)
          : null,
        openCases,
        byStatus,
        capacityUsedPercent:
          investigator.maxOpenCases > 0
            ? Math.round((openCases / investigator.maxOpenCases) * 100)
            : null,
        atCapacity: openCases >= investigator.maxOpenCases,
      };
    });
  }
}
