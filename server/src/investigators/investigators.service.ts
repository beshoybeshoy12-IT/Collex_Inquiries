import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvestigatorStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { AuthCacheService } from '../auth/auth-cache.service';
import { paginate } from '../common/interfaces/api.interface';
import { OPEN_FOR_INVESTIGATOR } from '../investigations/case-status.machine';
import {
  CreateInvestigatorDto,
  InvestigatorQueryDto,
  UpdateAvailabilityDto,
  UpdateInvestigatorDto,
  UpdateLocationDto,
} from './dto/investigator.dto';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';

/**
 * `passwordHash` is absent from every projection in this file. It is the one
 * column that must never leave the service, and listing the columns explicitly
 * — rather than excluding one from a spread — is what guarantees a new column
 * does not join a response by accident.
 */
const INVESTIGATOR_SELECT = {
  id: true,
  employeeCode: true,
  fullName: true,
  email: true,
  phone: true,
  nationalId: true,
  avatarUrl: true,
  status: true,
  availability: true,
  locale: true,
  governorateIds: true,
  cityIds: true,
  districtIds: true,
  areaIds: true,
  investigationTypeIds: true,
  productIds: true,
  skills: true,
  maxDailyCases: true,
  maxOpenCases: true,
  qualityScore: true,
  avgTatMinutes: true,
  completedCount: true,
  rejectedCount: true,
  slaBreachCount: true,
  trainingCompletedAt: true,
  contractEndsAt: true,
  lastActivityAt: true,
  deviceModel: true,
  devicePlatform: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.InvestigatorSelect;

/** Position is only ever included when the caller holds the location grant. */
const LOCATION_SELECT = {
  lastLat: true,
  lastLng: true,
  lastLocationAt: true,
} satisfies Prisma.InvestigatorSelect;

@Injectable()
export class InvestigatorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly authCache: AuthCacheService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Read
  // ─────────────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    query: InvestigatorQueryDto,
    includeLocation: boolean,
  ) {
    const where: Prisma.InvestigatorWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.availability ? { availability: query.availability } : {}),
      ...(query.governorateId
        ? { governorateIds: { has: query.governorateId } }
        : {}),
      ...(query.investigationTypeId
        ? { investigationTypeIds: { has: query.investigationTypeId } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { employeeCode: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total, workloads] = await Promise.all([
      this.prisma.investigator.findMany({
        where,
        select: {
          ...INVESTIGATOR_SELECT,
          ...(includeLocation ? LOCATION_SELECT : {}),
        },
        orderBy: query.orderBy(
          [
            'fullName',
            'employeeCode',
            'createdAt',
            'qualityScore',
            'completedCount',
          ],
          'fullName',
        ),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.investigator.count({ where }),
      // One grouped count for the whole page, not one query per row.
      this.prisma.investigation.groupBy({
        by: ['investigatorId'],
        where: {
          tenantId,
          deletedAt: null,
          status: { in: OPEN_FOR_INVESTIGATOR },
        },
        _count: { _all: true },
      }),
    ]);

    const openByInvestigator = new Map(
      workloads.map((row) => [row.investigatorId, row._count._all]),
    );

    return paginate(
      rows.map((row) =>
        this.decorate(row, openByInvestigator.get(row.id) ?? 0),
      ),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(tenantId: string, id: string, includeLocation: boolean) {
    const investigator = await this.prisma.investigator.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: {
        ...INVESTIGATOR_SELECT,
        ...(includeLocation ? LOCATION_SELECT : {}),
        documents: {
          select: {
            id: true,
            kind: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            expiresAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!investigator) {
      throw new NotFoundException('الباحث غير موجود - Investigator not found');
    }

    const openCases = await this.prisma.investigation.count({
      where: {
        tenantId,
        investigatorId: id,
        deletedAt: null,
        status: { in: OPEN_FOR_INVESTIGATOR },
      },
    });

    return this.decorate(investigator, openCases);
  }

  /**
   * Performance, computed from the case history rather than read from the
   * denormalised counters — this is the screen where the figures have to be
   * right, and the counters exist for ranking speed, not for reporting.
   */
  async performance(tenantId: string, id: string, from?: Date, to?: Date) {
    const investigator = await this.prisma.investigator.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: { id: true, fullName: true, employeeCode: true },
    });
    if (!investigator) {
      throw new NotFoundException('الباحث غير موجود - Investigator not found');
    }

    const period: Prisma.InvestigationWhereInput = {
      tenantId,
      investigatorId: id,
      deletedAt: null,
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const [byStatus, qcOutcomes, completed] = await Promise.all([
      this.prisma.investigation.groupBy({
        by: ['status'],
        where: period,
        _count: { _all: true },
      }),
      this.prisma.qcReview.groupBy({
        by: ['decision'],
        where: { tenantId, investigation: { investigatorId: id } },
        _count: { _all: true },
      }),
      this.prisma.investigation.findMany({
        where: {
          ...period,
          completedAt: { not: null },
          acceptedAt: { not: null },
        },
        select: {
          acceptedAt: true,
          submittedAt: true,
          completedAt: true,
          createdAt: true,
          dueAt: true,
        },
      }),
    ]);

    const fieldMinutes = completed
      .filter((c) => c.acceptedAt && c.submittedAt)
      .map(
        (c) => (c.submittedAt!.getTime() - c.acceptedAt!.getTime()) / 60_000,
      );

    const onTime = completed.filter(
      (c) => c.dueAt && c.completedAt && c.completedAt <= c.dueAt,
    ).length;

    const approvals =
      qcOutcomes.find((o) => o.decision === 'APPROVED')?._count._all ?? 0;
    const rejections =
      (qcOutcomes.find((o) => o.decision === 'REJECTED')?._count._all ?? 0) +
      (qcOutcomes.find((o) => o.decision === 'REWORK')?._count._all ?? 0);
    const reviewed = approvals + rejections;

    return {
      investigator,
      period: { from: from ?? null, to: to ?? null },
      caseCounts: Object.fromEntries(
        byStatus.map((row) => [row.status, row._count._all]),
      ),
      totalCases: byStatus.reduce((sum, row) => sum + row._count._all, 0),
      completedCases: completed.length,
      // A first-pass rate rather than a raw approval count: what matters is how
      // often work comes back, not how much of it there was.
      qcApprovalRate:
        reviewed > 0 ? Math.round((approvals / reviewed) * 100) : null,
      qcReviewed: reviewed,
      qcRejections: rejections,
      slaComplianceRate:
        completed.length > 0
          ? Math.round((onTime / completed.length) * 100)
          : null,
      avgFieldMinutes:
        fieldMinutes.length > 0
          ? Math.round(
              fieldMinutes.reduce((a, b) => a + b, 0) / fieldMinutes.length,
            )
          : null,
    };
  }

  /** Live positions for the map. Only reachable with the location permission. */
  async liveMap(tenantId: string) {
    const investigators = await this.prisma.investigator.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: InvestigatorStatus.ACTIVE,
        lastLat: { not: null },
        lastLng: { not: null },
      },
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        availability: true,
        lastLat: true,
        lastLng: true,
        lastLocationAt: true,
        governorateIds: true,
      },
    });

    const workloads = await this.prisma.investigation.groupBy({
      by: ['investigatorId'],
      where: {
        tenantId,
        deletedAt: null,
        status: { in: OPEN_FOR_INVESTIGATOR },
      },
      _count: { _all: true },
    });
    const open = new Map(
      workloads.map((w) => [w.investigatorId, w._count._all]),
    );

    return investigators.map((i) => ({
      id: i.id,
      fullName: i.fullName,
      employeeCode: i.employeeCode,
      availability: i.availability,
      lat: i.lastLat ? Number(i.lastLat) : null,
      lng: i.lastLng ? Number(i.lastLng) : null,
      updatedAt: i.lastLocationAt,
      openCases: open.get(i.id) ?? 0,
      // How stale the fix is, so the map can fade an hour-old pin rather than
      // presenting it as current.
      staleMinutes: i.lastLocationAt
        ? Math.floor((Date.now() - i.lastLocationAt.getTime()) / 60_000)
        : null,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Write
  // ─────────────────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    actor: AuthenticatedUser,
    dto: CreateInvestigatorDto,
  ) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { maxInvestigators: true },
    });

    const count = await this.prisma.investigator.count({
      where: { tenantId, deletedAt: null },
    });
    if (count >= tenant.maxInvestigators) {
      throw new BadRequestException(
        `تم الوصول للحد الأقصى من الباحثين (${tenant.maxInvestigators}) - ` +
          `The investigator limit for this plan (${tenant.maxInvestigators}) has been reached`,
      );
    }

    const clash = await this.prisma.investigator.findFirst({
      where: { tenantId, employeeCode: dto.employeeCode },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        'كود الموظف مستخدم بالفعل - This employee code is already in use',
      );
    }

    const password = this.passwords.generate();
    const passwordHash = await this.passwords.hash(password);

    const investigator = await this.prisma.investigator.create({
      data: {
        tenantId,
        ...dto,
        passwordHash,
        // A new investigator starts IN_TRAINING: they can sign in to the mobile
        // app and learn it, but the assignment eligibility check refuses to
        // give them real work until somebody marks them ACTIVE.
        status: dto.status ?? InvestigatorStatus.IN_TRAINING,
      },
      select: INVESTIGATOR_SELECT,
    });

    await this.audit.log({
      tenantId,
      action: 'INVESTIGATOR_CREATED',
      category: 'INVESTIGATOR',
      severity: 'NOTICE',
      entityType: 'Investigator',
      entityId: investigator.id,
      entityLabel: investigator.employeeCode,
      newValue: {
        employeeCode: dto.employeeCode,
        fullName: dto.fullName,
        phone: dto.phone,
      },
    });

    void actor;
    return { investigator, temporaryPassword: password };
  }

  async update(tenantId: string, id: string, dto: UpdateInvestigatorDto) {
    const existing = await this.prisma.investigator.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: INVESTIGATOR_SELECT,
    });
    if (!existing) {
      throw new NotFoundException('الباحث غير موجود - Investigator not found');
    }

    const updated = await this.prisma.investigator.update({
      where: { id },
      data: dto,
      select: INVESTIGATOR_SELECT,
    });

    await this.authCache.invalidatePrincipal(id);

    const { oldValue, newValue } = this.audit.diff(
      existing,
      dto as Record<string, unknown>,
    );

    await this.audit.log({
      tenantId,
      action: 'INVESTIGATOR_UPDATED',
      category: 'INVESTIGATOR',
      entityType: 'Investigator',
      entityId: id,
      entityLabel: existing.employeeCode,
      oldValue,
      newValue,
    });

    return updated;
  }

  /**
   * Change employment status.
   *
   * Suspending or deactivating ends every session — the handset in their pocket
   * stops working immediately, which is the entire point of doing it.
   */
  async setStatus(
    tenantId: string,
    id: string,
    status: InvestigatorStatus,
    reason?: string,
  ) {
    const existing = await this.prisma.investigator.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: { id: true, employeeCode: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException('الباحث غير موجود - Investigator not found');
    }

    // Deactivating somebody holding live cases leaves those cases stranded, so
    // it is refused with a count rather than done quietly.
    if (status !== InvestigatorStatus.ACTIVE) {
      const open = await this.prisma.investigation.count({
        where: {
          tenantId,
          investigatorId: id,
          deletedAt: null,
          status: { in: OPEN_FOR_INVESTIGATOR },
        },
      });
      if (open > 0) {
        throw new BadRequestException(
          `الباحث لديه ${open} تحقيق مفتوح، يجب إعادة إسنادها أولًا - ` +
            `This investigator holds ${open} open case(s); reassign them first`,
        );
      }
    }

    const updated = await this.prisma.investigator.update({
      where: { id },
      data: {
        status,
        ...(status !== InvestigatorStatus.ACTIVE
          ? { availability: 'OFFLINE' }
          : {}),
      },
      select: INVESTIGATOR_SELECT,
    });

    if (
      status === InvestigatorStatus.SUSPENDED ||
      status === InvestigatorStatus.INACTIVE
    ) {
      await this.authCache.revokePrincipalSessions(
        id,
        reason ?? `status changed to ${status}`,
      );
    } else {
      await this.authCache.invalidatePrincipal(id);
    }

    await this.audit.log({
      tenantId,
      action: 'INVESTIGATOR_STATUS_CHANGED',
      category: 'INVESTIGATOR',
      severity: 'WARNING',
      entityType: 'Investigator',
      entityId: id,
      entityLabel: existing.employeeCode,
      oldValue: { status: existing.status },
      newValue: { status },
      metadata: reason ? { reason } : undefined,
    });

    return updated;
  }

  async resetPassword(tenantId: string, id: string) {
    const existing = await this.prisma.investigator.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: { id: true, employeeCode: true },
    });
    if (!existing) {
      throw new NotFoundException('الباحث غير موجود - Investigator not found');
    }

    const password = this.passwords.generate();
    await this.prisma.investigator.update({
      where: { id },
      data: { passwordHash: await this.passwords.hash(password) },
    });

    await this.authCache.revokePrincipalSessions(id, 'password reset by admin');

    await this.audit.log({
      tenantId,
      action: 'INVESTIGATOR_PASSWORD_RESET',
      category: 'SECURITY',
      severity: 'WARNING',
      entityType: 'Investigator',
      entityId: id,
      entityLabel: existing.employeeCode,
    });

    return { temporaryPassword: password };
  }

  /**
   * The investigator's own availability, set from the handset.
   *
   * Takes the id from the authenticated principal at the controller, never from
   * a body — an investigator marking a colleague unavailable is not a request
   * this API can express.
   */
  async setOwnAvailability(
    tenantId: string,
    investigatorId: string,
    dto: UpdateAvailabilityDto,
  ) {
    await this.prisma.investigator.update({
      where: { id: investigatorId },
      data: { availability: dto.availability, lastActivityAt: new Date() },
    });
    void tenantId;
    return { availability: dto.availability };
  }

  /**
   * A position report from the handset.
   *
   * Writes the denormalised last-known position on the investigator and, when
   * it belongs to a case, appends an immutable `GpsEvent`. The two are
   * different things: one is "where are they now" for the map, the other is
   * evidence.
   */
  async reportLocation(
    tenantId: string,
    investigatorId: string,
    dto: UpdateLocationDto,
  ) {
    const now = new Date();

    await this.prisma.investigator.update({
      where: { id: investigatorId },
      data: {
        lastLat: dto.lat,
        lastLng: dto.lng,
        lastLocationAt: now,
        lastActivityAt: now,
        ...(dto.availability ? { availability: dto.availability } : {}),
      },
    });

    await this.prisma.gpsEvent.create({
      data: {
        tenantId,
        investigatorId,
        investigationId: dto.investigationId ?? null,
        eventType: 'LOCATION_UPDATE',
        lat: dto.lat,
        lng: dto.lng,
        accuracyM: dto.accuracyM,
        speedMps: dto.speedMps,
        headingDeg: dto.headingDeg,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : now,
      },
    });

    return { recorded: true };
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.investigator.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: { id: true, employeeCode: true },
    });
    if (!existing) {
      throw new NotFoundException('الباحث غير موجود - Investigator not found');
    }

    const open = await this.prisma.investigation.count({
      where: {
        tenantId,
        investigatorId: id,
        deletedAt: null,
        status: { in: OPEN_FOR_INVESTIGATOR },
      },
    });
    if (open > 0) {
      throw new BadRequestException(
        `الباحث لديه ${open} تحقيق مفتوح، يجب إعادة إسنادها أولًا - ` +
          `This investigator holds ${open} open case(s); reassign them first`,
      );
    }

    await this.prisma.investigator.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: InvestigatorStatus.INACTIVE,
        availability: 'OFFLINE',
        employeeCode: `${existing.employeeCode}.deleted.${Date.now()}`,
      },
    });

    await this.authCache.revokePrincipalSessions(id, 'account deleted');

    await this.audit.log({
      tenantId,
      action: 'INVESTIGATOR_DELETED',
      category: 'INVESTIGATOR',
      severity: 'CRITICAL',
      entityType: 'Investigator',
      entityId: id,
      entityLabel: existing.employeeCode,
    });

    return { success: true };
  }

  /** Decimals to numbers, plus the workload figures the UI needs. */
  private decorate(row: Record<string, unknown>, openCases: number) {
    return {
      ...row,
      qualityScore: row.qualityScore ? Number(row.qualityScore) : null,
      lastLat:
        row.lastLat !== undefined ? numberOrNull(row.lastLat) : undefined,
      lastLng:
        row.lastLng !== undefined ? numberOrNull(row.lastLng) : undefined,
      openCases,
      capacityUsedPercent:
        typeof row.maxOpenCases === 'number' && row.maxOpenCases > 0
          ? Math.round((openCases / row.maxOpenCases) * 100)
          : null,
      atCapacity:
        typeof row.maxOpenCases === 'number' && openCases >= row.maxOpenCases,
    };
  }
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
