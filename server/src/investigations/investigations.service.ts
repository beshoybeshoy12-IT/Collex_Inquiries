import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvestigationStatus,
  Prisma,
  PrincipalType,
  SlaPolicy,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseNumberService } from './case-number.service';
import { SlaPolicyService } from './sla-policy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  assertTransition,
  allowedNextStatuses,
  OPEN_FOR_INVESTIGATOR,
  STATUS_GROUPS,
} from './case-status.machine';
import { assessSla, computeTat } from './sla.util';
import { paginate } from '../common/interfaces/api.interface';
import { P } from '../common/constants/permissions';
import {
  AddCommentDto,
  CreateInvestigationDto,
  InvestigationQueryDto,
  TransitionInvestigationDto,
  UpdateInvestigationDto,
} from './dto/investigation.dto';
import {
  AuthenticatedPrincipal,
  AuthenticatedUser,
  isWebUser,
} from '../common/decorators/auth.decorators';

/** The relations the case list needs — no more, so the query stays cheap. */
const LIST_INCLUDE = {
  customer: {
    select: { id: true, fullName: true, mobile: true, nationalId: true },
  },
  product: { select: { id: true, code: true, nameAr: true, nameEn: true } },
  investigationType: {
    select: {
      id: true,
      code: true,
      nameAr: true,
      nameEn: true,
      colorHex: true,
    },
  },
  governorate: { select: { id: true, nameAr: true, nameEn: true } },
  city: { select: { id: true, nameAr: true, nameEn: true } },
  investigator: {
    select: { id: true, fullName: true, employeeCode: true, phone: true },
  },
  coordinator: { select: { id: true, fullName: true } },
  slaPolicy: true,
} satisfies Prisma.InvestigationInclude;

@Injectable()
export class InvestigationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly caseNumbers: CaseNumberService,
    private readonly slaPolicies: SlaPolicyService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Visibility
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * The extra `where` that narrows a list to what this user may see.
   *
   * Tenancy is already handled — by the explicit `tenantId` below and by the
   * guard underneath it. This is the second axis: within their own company,
   * who sees which cases.
   *
   *   - `investigations.view_all` → everything in the tenant.
   *   - otherwise → cases they coordinate, plus anything in a governorate they
   *     are assigned to.
   *
   * A user with neither the permission nor any governorate sees only their own
   * cases, which is the correct floor rather than an empty screen: a
   * coordinator with no geography configured still has their own work.
   */
  private visibilityFilter(
    user: AuthenticatedUser,
  ): Prisma.InvestigationWhereInput {
    if (
      user.isSuperAdmin ||
      user.permissions.includes(P.INVESTIGATIONS_VIEW_ALL)
    ) {
      return {};
    }

    const clauses: Prisma.InvestigationWhereInput[] = [
      { coordinatorId: user.id },
      { createdById: user.id },
    ];

    if (user.allowedGovernorateIds.length > 0) {
      clauses.push({ governorateId: { in: user.allowedGovernorateIds } });
    }

    return { OR: clauses };
  }

  /**
   * The same visibility rule for callers in other modules, which must not
   * grow their own copy of it. Returns the bare row, or 404.
   */
  async assertVisible(
    tenantId: string,
    id: string,
    principal: AuthenticatedPrincipal,
  ) {
    return this.findVisible(tenantId, id, principal);
  }

  /** Load a case the caller is allowed to see, or 404. */
  private async findVisible(
    tenantId: string,
    id: string,
    principal: AuthenticatedPrincipal,
    include?: Prisma.InvestigationInclude,
  ) {
    const scope = isWebUser(principal)
      ? this.visibilityFilter(principal)
      : // An investigator sees a case only while it is theirs. Not "was ever
        // theirs" — a reassigned case must disappear from the old handset.
        { investigatorId: principal.id };

    const investigation = await this.prisma.investigation.findFirst({
      where: { tenantId, id, deletedAt: null, ...scope },
      include,
    });

    if (!investigation) {
      // Deliberately 404 and not 403: telling a caller that a case exists but
      // is not theirs confirms the case number, which is guessable.
      throw new NotFoundException(
        'التحقيق غير موجود - Investigation not found',
      );
    }

    return investigation;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Read
  // ─────────────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    user: AuthenticatedUser,
    query: InvestigationQueryDto,
  ) {
    const where = this.buildWhere(tenantId, query, this.visibilityFilter(user));

    const [rows, total, policies] = await Promise.all([
      this.prisma.investigation.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: query.orderBy(
          [
            'createdAt',
            'dueAt',
            'priority',
            'status',
            'caseNumber',
            'updatedAt',
          ],
          'createdAt',
        ),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.investigation.count({ where }),
      this.slaPolicies.listActive(tenantId),
    ]);

    return paginate(
      rows.map((row) => this.decorate(row, policies)),
      total,
      query.page,
      query.limit,
    );
  }

  private buildWhere(
    tenantId: string,
    query: InvestigationQueryDto,
    visibility: Prisma.InvestigationWhereInput,
  ): Prisma.InvestigationWhereInput {
    const statuses = query.statusGroup
      ? [...STATUS_GROUPS[query.statusGroup]]
      : query.status;

    const and: Prisma.InvestigationWhereInput[] = [visibility];

    if (query.search) {
      // Trigram-indexed columns plus the customer's identifying fields — the
      // things a coordinator actually types into a search box.
      and.push({
        OR: [
          { caseNumber: { contains: query.search, mode: 'insensitive' } },
          {
            applicationNumber: { contains: query.search, mode: 'insensitive' },
          },
          {
            customer: {
              is: {
                OR: [
                  { fullName: { contains: query.search, mode: 'insensitive' } },
                  { nationalId: { contains: query.search } },
                  { mobile: { contains: query.search } },
                  {
                    workplaceName: {
                      contains: query.search,
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            },
          },
        ],
      });
    }

    if (query.overdue) {
      and.push({
        dueAt: { lt: new Date() },
        status: {
          notIn: [...STATUS_GROUPS.COMPLETED, ...STATUS_GROUPS.CLOSED],
        },
      });
    }

    return {
      tenantId,
      deletedAt: null,
      ...(statuses?.length ? { status: { in: statuses } } : {}),
      ...(query.priority?.length ? { priority: { in: query.priority } } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.investigationTypeId
        ? { investigationTypeId: query.investigationTypeId }
        : {}),
      ...(query.governorateId ? { governorateId: query.governorateId } : {}),
      ...(query.cityId ? { cityId: query.cityId } : {}),
      ...(query.investigatorId ? { investigatorId: query.investigatorId } : {}),
      ...(query.coordinatorId ? { coordinatorId: query.coordinatorId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.importBatchId ? { importBatchId: query.importBatchId } : {}),
      ...(query.unassigned ? { investigatorId: null } : {}),
      ...(query.reworked ? { reworkCount: { gt: 0 } } : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom
                ? { gte: new Date(query.createdFrom) }
                : {}),
              ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
            },
          }
        : {}),
      ...(query.dueBefore ? { dueAt: { lte: new Date(query.dueBefore) } } : {}),
      AND: and,
    };
  }

  /** Attach the derived SLA and TAT figures. Never stored — see `sla.util`. */
  private decorate(
    investigation: Prisma.InvestigationGetPayload<{
      include: typeof LIST_INCLUDE;
    }>,
    policies: SlaPolicy[],
  ) {
    const policy =
      investigation.slaPolicy ??
      this.slaPolicies.select(policies, {
        productId: investigation.productId,
        investigationTypeId: investigation.investigationTypeId,
        priority: investigation.priority,
      });

    const timeline = {
      createdAt: investigation.createdAt,
      assignedAt: investigation.assignedAt,
      acceptedAt: investigation.acceptedAt,
      startedAt: investigation.startedAt,
      submittedAt: investigation.submittedAt,
      qcAt: investigation.qcAt,
      completedAt: investigation.completedAt,
      dueAt: investigation.dueAt,
      status: investigation.status,
    };

    return {
      ...investigation,
      sla: assessSla(timeline, policy),
      tat: computeTat(timeline, policy),
    };
  }

  async findOne(
    tenantId: string,
    id: string,
    principal: AuthenticatedPrincipal,
  ) {
    const investigation = await this.findVisible(tenantId, id, principal, {
      ...LIST_INCLUDE,
      customer: true,
      district: { select: { id: true, nameAr: true, nameEn: true } },
      area: { select: { id: true, nameAr: true, nameEn: true } },
      importBatch: { select: { id: true, reference: true, fileName: true } },
      formVersion: { select: { id: true, version: true, templateId: true } },
      assignments: {
        orderBy: { assignedAt: 'desc' },
        include: {
          investigator: {
            select: { id: true, fullName: true, employeeCode: true },
          },
          assignedBy: { select: { id: true, fullName: true } },
        },
      },
      qcReviews: {
        orderBy: { reviewedAt: 'desc' },
        include: {
          reviewer: { select: { id: true, fullName: true } },
          reasons: { include: { reason: true } },
        },
      },
      reports: {
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          status: true,
          locale: true,
          isFinal: true,
          fileName: true,
          generatedAt: true,
        },
      },
    });

    const policies = await this.slaPolicies.listActive(tenantId);

    return {
      ...this.decorate(investigation as never, policies),
      // What this particular caller may do next — the case screen's action bar
      // renders straight from this rather than reimplementing the machine.
      allowedTransitions: allowedNextStatuses(
        investigation.status,
        principal.principalType,
      ),
    };
  }

  /** The case timeline — status history and comments, merged in time order. */
  async timeline(
    tenantId: string,
    id: string,
    principal: AuthenticatedPrincipal,
  ) {
    await this.findVisible(tenantId, id, principal);

    const [history, comments, assignments] = await Promise.all([
      this.prisma.investigationStatusHistory.findMany({
        where: { tenantId, investigationId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.investigationComment.findMany({
        where: {
          tenantId,
          investigationId: id,
          // An internal note is invisible to the field investigator, which is
          // the whole reason the flag exists.
          ...(isWebUser(principal) ? {} : { isInternal: false }),
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.assignment.findMany({
        where: { tenantId, investigationId: id },
        orderBy: { assignedAt: 'asc' },
        include: {
          investigator: { select: { id: true, fullName: true } },
          assignedBy: { select: { id: true, fullName: true } },
        },
      }),
    ]);

    const events = [
      ...history.map((row) => ({
        kind: 'STATUS' as const,
        at: row.createdAt,
        actorName: row.actorName,
        actorType: row.actorType,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        reason: row.reason,
        metadata: row.metadata,
      })),
      ...comments.map((row) => ({
        kind: 'COMMENT' as const,
        at: row.createdAt,
        actorName: row.authorName,
        actorType: row.authorType,
        body: row.body,
        isInternal: row.isInternal,
      })),
      ...assignments.map((row) => ({
        kind: 'ASSIGNMENT' as const,
        at: row.assignedAt,
        actorName: row.assignedBy?.fullName ?? null,
        actorType: PrincipalType.WEB_USER,
        investigatorName: row.investigator.fullName,
        status: row.status,
        method: row.method,
        reason: row.reassignReason ?? row.rejectReason,
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    return events;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Write
  // ─────────────────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    user: AuthenticatedUser,
    dto: CreateInvestigationDto,
  ) {
    if (!dto.customerId && !dto.customer) {
      throw new BadRequestException(
        'يجب تحديد عميل موجود أو إدخال بيانات عميل جديد - ' +
          'Provide either an existing customerId or a new customer',
      );
    }

    const [tenant, product, type] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { code: true },
      }),
      this.prisma.product.findFirst({
        where: { tenantId, id: dto.productId, isActive: true },
        select: { id: true, defaultSlaHours: true, defaultPriority: true },
      }),
      this.prisma.investigationType.findFirst({
        where: { tenantId, id: dto.investigationTypeId, isActive: true },
        select: { id: true, defaultSlaHours: true },
      }),
    ]);

    if (!tenant) throw new NotFoundException('Tenant not found');
    if (!product) {
      throw new BadRequestException(
        'المنتج غير موجود أو غير مفعل - Product not found or inactive',
      );
    }
    if (!type) {
      throw new BadRequestException(
        'نوع التحقيق غير موجود أو غير مفعل - Investigation type not found or inactive',
      );
    }

    // The pairing has to be one the product allows — that row is what makes
    // "Credit Card + Residence" a legal case rather than a typo.
    const pairing = await this.prisma.productInvestigationType.findUnique({
      where: {
        productId_investigationTypeId: {
          productId: product.id,
          investigationTypeId: type.id,
        },
      },
      select: { isActive: true, slaHours: true },
    });

    if (!pairing?.isActive) {
      throw new BadRequestException(
        'نوع التحقيق غير متاح لهذا المنتج - ' +
          'This investigation type is not enabled for this product',
      );
    }

    const priority = dto.priority ?? product.defaultPriority;

    const policy = await this.slaPolicies.resolve(tenantId, {
      productId: product.id,
      investigationTypeId: type.id,
      priority,
    });

    const dueAt = dto.dueAt
      ? new Date(dto.dueAt)
      : this.slaPolicies.dueDateFor(
          policy,
          pairing.slaHours ?? type.defaultSlaHours ?? product.defaultSlaHours,
        );

    const investigation = await this.prisma.$transaction(async (tx) => {
      const customerId = dto.customerId
        ? await this.assertCustomer(tx, tenantId, dto.customerId)
        : (
            await tx.customer.create({
              data: {
                tenantId,
                ...dto.customer!,
                createdById: user.id,
              },
              select: { id: true },
            })
          ).id;

      // Fall back to the customer's own address when the case does not carry
      // one — which is the normal case for a manually created residence check.
      const customer = await tx.customer.findUniqueOrThrow({
        where: { id: customerId },
        select: {
          residenceAddress: true,
          governorateId: true,
          cityId: true,
          districtId: true,
          areaId: true,
        },
      });

      const caseNumber = await this.caseNumbers.allocateOne(
        tenantId,
        tenant.code,
        tx,
      );

      const created = await tx.investigation.create({
        data: {
          tenantId,
          caseNumber,
          applicationNumber: dto.applicationNumber,
          customerId,
          productId: product.id,
          investigationTypeId: type.id,
          priority,
          source: 'MANUAL',
          status: InvestigationStatus.NEW,
          addressLine: dto.addressLine ?? customer.residenceAddress,
          governorateId: dto.governorateId ?? customer.governorateId,
          cityId: dto.cityId ?? customer.cityId,
          districtId: dto.districtId ?? customer.districtId,
          areaId: dto.areaId ?? customer.areaId,
          coordinatorId: user.id,
          createdById: user.id,
          slaPolicyId: policy?.id,
          dueAt,
          notes: dto.notes,
        },
        include: LIST_INCLUDE,
      });

      await tx.investigationStatusHistory.create({
        data: {
          tenantId,
          investigationId: created.id,
          fromStatus: null,
          toStatus: InvestigationStatus.NEW,
          actorType: PrincipalType.WEB_USER,
          actorId: user.id,
          actorName: user.fullName,
          reason: 'Case created',
        },
      });

      return created;
    });

    await this.audit.log({
      tenantId,
      action: 'CASE_CREATED',
      category: 'INVESTIGATION',
      entityType: 'Investigation',
      entityId: investigation.id,
      entityLabel: investigation.caseNumber,
      newValue: {
        caseNumber: investigation.caseNumber,
        productId: product.id,
        investigationTypeId: type.id,
        priority,
      },
    });

    this.realtime.emitToTenant(tenantId, 'investigation:created', {
      id: investigation.id,
      caseNumber: investigation.caseNumber,
      status: investigation.status,
    });

    return investigation;
  }

  async update(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
    dto: UpdateInvestigationDto,
  ) {
    const existing = await this.findVisible(tenantId, id, user);

    // A case that has left the office is no longer the coordinator's to edit:
    // changing the address under an investigator who is standing at the old one
    // is worse than refusing.
    const editable: InvestigationStatus[] = [
      InvestigationStatus.NEW,
      InvestigationStatus.VALIDATING,
      InvestigationStatus.READY_FOR_ASSIGNMENT,
    ];
    if (!editable.includes(existing.status)) {
      throw new BadRequestException(
        'لا يمكن تعديل التحقيق بعد إسناده - ' +
          'A case cannot be edited once it has been assigned',
      );
    }

    const { customer: _inline, customerId, ...scalars } = dto;

    const updated = await this.prisma.investigation.update({
      where: { id },
      data: {
        ...scalars,
        ...(dto.dueAt ? { dueAt: new Date(dto.dueAt) } : {}),
        ...(customerId
          ? {
              customerId: await this.assertCustomer(
                this.prisma,
                tenantId,
                customerId,
              ),
            }
          : {}),
      },
      include: LIST_INCLUDE,
    });

    const { oldValue, newValue } = this.audit.diff(existing, {
      ...scalars,
      ...(customerId ? { customerId } : {}),
    });

    await this.audit.log({
      tenantId,
      action: 'CASE_UPDATED',
      category: 'INVESTIGATION',
      entityType: 'Investigation',
      entityId: id,
      entityLabel: existing.caseNumber,
      oldValue,
      newValue,
    });

    return updated;
  }

  /**
   * The one door status changes go through.
   *
   * Everything interesting happens here: the machine validates the move, the
   * matching timestamp is stamped, a history row is appended and the people who
   * care are told. No other method writes `status`.
   */
  async transition(
    tenantId: string,
    id: string,
    principal: AuthenticatedPrincipal,
    dto: TransitionInvestigationDto,
  ) {
    const existing = await this.findVisible(tenantId, id, principal);

    const rule = assertTransition(
      existing.status,
      dto.status,
      principal.principalType,
      dto.reason,
    );

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.investigation.update({
        where: { id },
        data: {
          status: dto.status,
          ...(rule.stamps ? { [rule.stamps]: now } : {}),
          ...(dto.result ? { result: dto.result } : {}),
          ...(dto.status === InvestigationStatus.REWORK
            ? { reworkCount: { increment: 1 } }
            : {}),
          ...(dto.status === InvestigationStatus.CANCELLED
            ? { cancelReason: dto.reason }
            : {}),
        },
        include: LIST_INCLUDE,
      });

      await tx.investigationStatusHistory.create({
        data: {
          tenantId,
          investigationId: id,
          fromStatus: existing.status,
          toStatus: dto.status,
          actorType: principal.principalType,
          actorId: principal.id,
          actorName: principal.fullName,
          reason: dto.reason,
        },
      });

      return next;
    });

    await this.audit.log({
      tenantId,
      action: `CASE_${dto.status}`,
      category: 'INVESTIGATION',
      severity:
        dto.status === InvestigationStatus.CANCELLED ? 'NOTICE' : 'INFO',
      entityType: 'Investigation',
      entityId: id,
      entityLabel: existing.caseNumber,
      oldValue: { status: existing.status },
      newValue: { status: dto.status },
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    this.realtime.emitToTenant(tenantId, 'investigation:status', {
      id,
      caseNumber: existing.caseNumber,
      from: existing.status,
      to: dto.status,
    });

    await this.notifyStatusChange(
      tenantId,
      updated,
      existing.status,
      dto.reason,
    );

    return updated;
  }

  /**
   * A transition driven by the system rather than a person.
   *
   * The AUTO_VALIDATION steps, the report-generation worker and the assignment
   * sweep all move cases with nobody behind them. They cannot go through
   * `transition()` because that resolves visibility from a principal, and there
   * is no principal — inventing a fake one would either fail the visibility
   * check or, worse, attribute "moved this case to QC" to the investigator on
   * the case timeline.
   *
   * The state machine still applies: `SYSTEM` is one of its actors, and a
   * transition it is not allowed to make is refused exactly as a human's would
   * be.
   */
  async systemTransition(
    tenantId: string,
    id: string,
    to: InvestigationStatus,
    reason?: string,
  ) {
    const existing = await this.prisma.investigation.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: { id: true, status: true, caseNumber: true },
    });

    if (!existing) {
      throw new NotFoundException(
        'التحقيق غير موجود - Investigation not found',
      );
    }

    const rule = assertTransition(existing.status, to, 'SYSTEM', reason);
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.investigation.update({
        where: { id },
        data: {
          status: to,
          ...(rule.stamps ? { [rule.stamps]: now } : {}),
          ...(to === InvestigationStatus.REWORK
            ? { reworkCount: { increment: 1 } }
            : {}),
        },
        include: LIST_INCLUDE,
      });

      await tx.investigationStatusHistory.create({
        data: {
          tenantId,
          investigationId: id,
          fromStatus: existing.status,
          toStatus: to,
          actorType: null,
          actorId: null,
          actorName: 'system',
          reason,
        },
      });

      return next;
    });

    this.realtime.emitToTenant(tenantId, 'investigation:status', {
      id,
      caseNumber: existing.caseNumber,
      from: existing.status,
      to,
    });

    await this.notifyStatusChange(tenantId, updated, existing.status, reason);

    return updated;
  }

  /** Who hears about which transition. */
  private async notifyStatusChange(
    tenantId: string,
    investigation: Prisma.InvestigationGetPayload<{
      include: typeof LIST_INCLUDE;
    }>,
    from: InvestigationStatus,
    reason?: string,
  ): Promise<void> {
    const label = investigation.caseNumber;

    switch (investigation.status) {
      case InvestigationStatus.SUBMITTED:
        if (investigation.coordinatorId) {
          await this.notifications.notifyUser(
            tenantId,
            investigation.coordinatorId,
            {
              type: 'CASE_SUBMITTED',
              titleAr: 'تم تسليم تحقيق',
              titleEn: 'Investigation submitted',
              bodyAr: `تم تسليم التحقيق ${label} من الباحث الميداني`,
              bodyEn: `Investigation ${label} was submitted by the field investigator`,
              entityType: 'Investigation',
              entityId: investigation.id,
              link: `/investigations/${investigation.id}`,
            },
          );
        }
        break;

      case InvestigationStatus.REWORK:
        if (investigation.investigatorId) {
          await this.notifications.notifyInvestigator(
            tenantId,
            investigation.investigatorId,
            {
              type: 'REWORK_REQUESTED',
              titleAr: 'مطلوب إعادة عمل',
              titleEn: 'Rework requested',
              bodyAr: `التحقيق ${label} يحتاج إلى تصحيح: ${reason ?? ''}`,
              bodyEn: `Investigation ${label} needs correction: ${reason ?? ''}`,
              entityType: 'Investigation',
              entityId: investigation.id,
              priority: 'HIGH',
            },
          );
        }
        break;

      case InvestigationStatus.QC_APPROVED:
        if (investigation.investigatorId) {
          await this.notifications.notifyInvestigator(
            tenantId,
            investigation.investigatorId,
            {
              type: 'QC_APPROVED',
              titleAr: 'تم اعتماد التحقيق',
              titleEn: 'Investigation approved',
              bodyAr: `تم اعتماد التحقيق ${label}`,
              bodyEn: `Investigation ${label} was approved`,
              entityType: 'Investigation',
              entityId: investigation.id,
            },
          );
        }
        break;

      default:
        // Most transitions are routine and do not warrant an interruption.
        // The realtime event above already refreshes anyone watching the list.
        break;
    }

    void from;
  }

  async addComment(
    tenantId: string,
    id: string,
    principal: AuthenticatedPrincipal,
    dto: AddCommentDto,
  ) {
    await this.findVisible(tenantId, id, principal);

    // Only a web user can write a note the investigator cannot see; an
    // investigator marking their own note internal would hide it from the
    // office, which is backwards.
    const isInternal = isWebUser(principal) ? (dto.isInternal ?? false) : false;

    const comment = await this.prisma.investigationComment.create({
      data: {
        tenantId,
        investigationId: id,
        authorType: principal.principalType,
        authorId: principal.id,
        authorName: principal.fullName,
        body: dto.body,
        isInternal,
      },
    });

    this.realtime.emitToTenant(tenantId, 'investigation:comment', {
      investigationId: id,
      isInternal,
    });

    return comment;
  }

  /** Bulk archive. Completed and cancelled cases only — the machine says so. */
  async archiveMany(tenantId: string, user: AuthenticatedUser, ids: string[]) {
    const cases = await this.prisma.investigation.findMany({
      where: { tenantId, id: { in: ids }, deletedAt: null },
      select: { id: true, status: true, caseNumber: true },
    });

    const results = {
      archived: 0,
      skipped: [] as { id: string; reason: string }[],
    };

    for (const item of cases) {
      try {
        assertTransition(
          item.status,
          InvestigationStatus.ARCHIVED,
          PrincipalType.WEB_USER,
        );
      } catch {
        results.skipped.push({
          id: item.id,
          reason: `Cannot archive a case in status ${item.status}`,
        });
        continue;
      }

      await this.prisma.$transaction([
        this.prisma.investigation.update({
          where: { id: item.id },
          data: {
            status: InvestigationStatus.ARCHIVED,
            archivedAt: new Date(),
          },
        }),
        this.prisma.investigationStatusHistory.create({
          data: {
            tenantId,
            investigationId: item.id,
            fromStatus: item.status,
            toStatus: InvestigationStatus.ARCHIVED,
            actorType: PrincipalType.WEB_USER,
            actorId: user.id,
            actorName: user.fullName,
            reason: 'Bulk archive',
          },
        }),
      ]);
      results.archived++;
    }

    await this.audit.log({
      tenantId,
      action: 'CASE_ARCHIVED_BULK',
      category: 'INVESTIGATION',
      severity: 'NOTICE',
      metadata: { requested: ids.length, ...results },
    });

    return results;
  }

  /** Soft delete. Hard deletes would orphan evidence and audit references. */
  async remove(tenantId: string, id: string, user: AuthenticatedUser) {
    const existing = await this.findVisible(tenantId, id, user);

    if (existing.status !== InvestigationStatus.NEW) {
      throw new ForbiddenException(
        'يمكن حذف التحقيقات الجديدة فقط، استخدم الإلغاء بدلاً من ذلك - ' +
          'Only NEW cases can be deleted; cancel the case instead',
      );
    }

    await this.prisma.investigation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      tenantId,
      action: 'CASE_DELETED',
      category: 'INVESTIGATION',
      severity: 'WARNING',
      entityType: 'Investigation',
      entityId: id,
      entityLabel: existing.caseNumber,
    });

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Counters for the dashboard sidebar
  // ─────────────────────────────────────────────────────────────────────────

  async counts(tenantId: string, user: AuthenticatedUser) {
    const visibility = this.visibilityFilter(user);
    const base: Prisma.InvestigationWhereInput = {
      tenantId,
      deletedAt: null,
      ...visibility,
    };

    const grouped = await this.prisma.investigation.groupBy({
      by: ['status'],
      where: base,
      _count: { _all: true },
    });

    const byStatus = Object.fromEntries(
      grouped.map((row) => [row.status, row._count._all]),
    ) as Record<InvestigationStatus, number>;

    const byGroup = Object.fromEntries(
      Object.entries(STATUS_GROUPS).map(([group, statuses]) => [
        group,
        statuses.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0),
      ]),
    );

    const overdue = await this.prisma.investigation.count({
      where: {
        ...base,
        dueAt: { lt: new Date() },
        status: {
          notIn: [...STATUS_GROUPS.COMPLETED, ...STATUS_GROUPS.CLOSED],
        },
      },
    });

    return {
      byStatus,
      byGroup,
      overdue,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    };
  }

  /** How much open work an investigator is carrying. Used before assigning. */
  async openCaseCount(
    tenantId: string,
    investigatorId: string,
  ): Promise<number> {
    return this.prisma.investigation.count({
      where: {
        tenantId,
        investigatorId,
        deletedAt: null,
        status: { in: OPEN_FOR_INVESTIGATOR },
      },
    });
  }

  private async assertCustomer(
    client: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    customerId: string,
  ): Promise<string> {
    const customer = await client.customer.findFirst({
      where: { tenantId, id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException('العميل غير موجود - Customer not found');
    }
    return customer.id;
  }
}
