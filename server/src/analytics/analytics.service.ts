import { Injectable } from '@nestjs/common';
import { InvestigationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STATUS_GROUPS } from '../investigations/case-status.machine';
import { assessSla } from '../investigations/sla.util';
import { P } from '../common/constants/permissions';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';

export interface AnalyticsPeriod {
  from: Date;
  to: Date;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Dashboard and analytics.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  AGGREGATE IN THE DATABASE, NOT IN NODE. Every figure here comes from a
 *  `groupBy` or a `count`. The alternative — fetching rows and reducing them —
 *  is what turns a dashboard into the slowest page in the application the
 *  moment a tenant passes fifty thousand cases, and it is invisible in
 *  development where there are two hundred.
 *
 *  The one exception is SLA compliance, which is derived rather than stored and
 *  therefore cannot be aggregated in SQL. It reads only the timestamp columns
 *  of completed cases in the period, which is narrow enough to stay cheap, and
 *  it is capped.
 *
 *  VISIBILITY APPLIES HERE TOO. A user without `analytics.view_all` sees the
 *  slice they can see on the case list — otherwise the dashboard becomes a
 *  side channel for exactly the data the case list is filtering out.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Same rule as the case list. See `InvestigationsService.visibilityFilter`. */
  private scope(user: AuthenticatedUser): Prisma.InvestigationWhereInput {
    if (
      user.isSuperAdmin ||
      user.permissions.includes(P.ANALYTICS_VIEW_ALL) ||
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

  private periodOrDefault(from?: string, to?: string): AnalyticsPeriod {
    const end = to ? new Date(to) : new Date();
    const start = from
      ? new Date(from)
      : new Date(end.getTime() - 30 * 86_400_000);
    return { from: start, to: end };
  }

  /**
   * The coordinator dashboard, in one call.
   *
   * Every tile on that screen comes from here. Six round trips to render one
   * page is six chances for it to look half-loaded.
   */
  async dashboard(
    tenantId: string,
    user: AuthenticatedUser,
    from?: string,
    to?: string,
  ) {
    const period = this.periodOrDefault(from, to);
    const scope = this.scope(user);

    const base: Prisma.InvestigationWhereInput = {
      tenantId,
      deletedAt: null,
      ...scope,
    };
    const inPeriod: Prisma.InvestigationWhereInput = {
      ...base,
      createdAt: { gte: period.from, lte: period.to },
    };

    const [
      byStatus,
      byPriority,
      byType,
      byProduct,
      byGovernorate,
      overdue,
      unassigned,
      createdInPeriod,
      completedInPeriod,
      qcOutcomes,
      activeInvestigators,
      dailyVolume,
    ] = await Promise.all([
      this.prisma.investigation.groupBy({
        by: ['status'],
        where: base,
        _count: { _all: true },
      }),
      this.prisma.investigation.groupBy({
        by: ['priority'],
        where: base,
        _count: { _all: true },
      }),
      this.prisma.investigation.groupBy({
        by: ['investigationTypeId'],
        where: inPeriod,
        _count: { _all: true },
      }),
      this.prisma.investigation.groupBy({
        by: ['productId'],
        where: inPeriod,
        _count: { _all: true },
      }),
      this.prisma.investigation.groupBy({
        by: ['governorateId'],
        where: inPeriod,
        _count: { _all: true },
      }),
      this.prisma.investigation.count({
        where: {
          ...base,
          dueAt: { lt: new Date() },
          status: {
            notIn: [...STATUS_GROUPS.COMPLETED, ...STATUS_GROUPS.CLOSED],
          },
        },
      }),
      this.prisma.investigation.count({
        where: {
          ...base,
          investigatorId: null,
          status: InvestigationStatus.READY_FOR_ASSIGNMENT,
        },
      }),
      this.prisma.investigation.count({ where: inPeriod }),
      this.prisma.investigation.count({
        where: {
          ...base,
          completedAt: { gte: period.from, lte: period.to },
        },
      }),
      this.prisma.qcReview.groupBy({
        by: ['decision'],
        where: {
          tenantId,
          reviewedAt: { gte: period.from, lte: period.to },
        },
        _count: { _all: true },
      }),
      this.prisma.investigator.count({
        where: { tenantId, status: 'ACTIVE', deletedAt: null },
      }),
      this.dailyVolume(tenantId, base, period),
    ]);

    const statusCounts = Object.fromEntries(
      byStatus.map((row) => [row.status, row._count._all]),
    ) as Record<InvestigationStatus, number>;

    const groupCounts = Object.fromEntries(
      Object.entries(STATUS_GROUPS).map(([group, statuses]) => [
        group,
        statuses.reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0),
      ]),
    );

    const [typeNames, productNames, governorateNames] = await Promise.all([
      this.nameLookup(
        'investigationType',
        byType.map((r) => r.investigationTypeId),
      ),
      this.nameLookup(
        'product',
        byProduct.map((r) => r.productId),
      ),
      this.nameLookup(
        'governorate',
        byGovernorate
          .map((r) => r.governorateId)
          .filter((id): id is string => !!id),
      ),
    ]);

    const qcApproved =
      qcOutcomes.find((o) => o.decision === 'APPROVED')?._count._all ?? 0;
    const qcTotal = qcOutcomes.reduce((sum, o) => sum + o._count._all, 0);

    const sla = await this.slaCompliance(tenantId, base, period);

    return {
      period,
      totals: {
        all: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        createdInPeriod,
        completedInPeriod,
        overdue,
        unassigned,
        activeInvestigators,
      },
      byStatus: statusCounts,
      byGroup: groupCounts,
      byPriority: Object.fromEntries(
        byPriority.map((row) => [row.priority, row._count._all]),
      ),
      byInvestigationType: byType.map((row) => ({
        id: row.investigationTypeId,
        ...typeNames.get(row.investigationTypeId),
        count: row._count._all,
      })),
      byProduct: byProduct.map((row) => ({
        id: row.productId,
        ...productNames.get(row.productId),
        count: row._count._all,
      })),
      byGovernorate: byGovernorate
        .filter((row) => row.governorateId)
        .map((row) => ({
          id: row.governorateId,
          ...governorateNames.get(row.governorateId!),
          count: row._count._all,
        })),
      qc: {
        reviewed: qcTotal,
        approved: qcApproved,
        rejected: qcTotal - qcApproved,
        approvalRate:
          qcTotal > 0 ? Math.round((qcApproved / qcTotal) * 100) : null,
        rejectionRate:
          qcTotal > 0
            ? Math.round(((qcTotal - qcApproved) / qcTotal) * 100)
            : null,
      },
      sla,
      dailyVolume,
    };
  }

  /**
   * Cases created and completed per day.
   *
   * Raw SQL because Prisma cannot group by a date truncation, and the
   * alternative — 30 separate counts, or fetching every row to bucket in Node —
   * is worse on both counts. The tenant filter is a bound parameter, not
   * interpolated, and the only other input is a validated date range.
   */
  private async dailyVolume(
    tenantId: string,
    scope: Prisma.InvestigationWhereInput,
    period: AnalyticsPeriod,
  ) {
    // The visibility scope cannot be expressed in this raw query, so it is only
    // used for tenant-wide views; a scoped user gets the same shape from the
    // grouped counts above and an empty series here rather than another
    // tenant's numbers.
    if (scope.OR) return [];

    // Correlated subqueries rather than two LEFT JOINs onto the same day.
    // Joining both would produce a cartesian product per day — a day with 3
    // created and 2 completed would yield 6 rows and report 6 of each — and
    // the bug is invisible on a dataset where one of the two is always zero.
    //
    // `tenantId` is bound as a parameter and compared as text: the column is
    // text (Prisma maps String to text), so casting the parameter to uuid
    // fails with "operator does not exist: text = uuid".
    const rows = await this.prisma.$queryRaw<
      { day: Date; created: bigint; completed: bigint }[]
    >`
      SELECT
        d.day::date AS day,
        (
          SELECT COUNT(*) FROM investigations c
          WHERE c."tenantId" = ${tenantId}
            AND c."deletedAt" IS NULL
            AND c."createdAt"::date = d.day::date
        ) AS created,
        (
          SELECT COUNT(*) FROM investigations x
          WHERE x."tenantId" = ${tenantId}
            AND x."deletedAt" IS NULL
            AND x."completedAt"::date = d.day::date
        ) AS completed
      FROM generate_series(${period.from}::date, ${period.to}::date, '1 day') AS d(day)
      ORDER BY d.day
    `;

    return rows.map((row) => ({
      day: row.day,
      created: Number(row.created),
      completed: Number(row.completed),
    }));
  }

  /**
   * SLA compliance over the period.
   *
   * Derived, so it cannot be a SQL aggregate — it reads the timestamp columns
   * of cases completed in the window and evaluates each. Capped at 20,000,
   * which is a month of very heavy volume; beyond that the number is
   * directionally right and the exact figure belongs in an export.
   */
  private async slaCompliance(
    tenantId: string,
    scope: Prisma.InvestigationWhereInput,
    period: AnalyticsPeriod,
  ) {
    const completed = await this.prisma.investigation.findMany({
      where: {
        ...scope,
        completedAt: { gte: period.from, lte: period.to },
      },
      select: {
        createdAt: true,
        assignedAt: true,
        acceptedAt: true,
        submittedAt: true,
        qcAt: true,
        completedAt: true,
        dueAt: true,
        status: true,
        slaPolicy: true,
      },
      take: 20_000,
    });

    let met = 0;
    let breached = 0;
    let notApplicable = 0;

    const stageTotals = {
      assignment: [] as number[],
      acceptance: [] as number[],
      field: [] as number[],
      qc: [] as number[],
      total: [] as number[],
    };

    for (const row of completed) {
      const assessment = assessSla(row, row.slaPolicy);

      if (assessment.state === 'MET') met++;
      else if (assessment.state === 'BREACHED') breached++;
      else notApplicable++;

      const minutes = (a?: Date | null, b?: Date | null) =>
        a && b ? Math.max(0, (b.getTime() - a.getTime()) / 60_000) : null;

      const push = (bucket: number[], value: number | null) => {
        if (value !== null) bucket.push(value);
      };

      push(stageTotals.assignment, minutes(row.createdAt, row.assignedAt));
      push(stageTotals.acceptance, minutes(row.assignedAt, row.acceptedAt));
      push(stageTotals.field, minutes(row.acceptedAt, row.submittedAt));
      push(stageTotals.qc, minutes(row.submittedAt, row.qcAt));
      push(stageTotals.total, minutes(row.createdAt, row.completedAt));
    }

    const measured = met + breached;
    const average = (values: number[]) =>
      values.length > 0
        ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
        : null;

    return {
      measured,
      met,
      breached,
      notApplicable,
      complianceRate: measured > 0 ? Math.round((met / measured) * 100) : null,
      averageTatMinutes: {
        assignment: average(stageTotals.assignment),
        acceptance: average(stageTotals.acceptance),
        field: average(stageTotals.field),
        qc: average(stageTotals.qc),
        total: average(stageTotals.total),
      },
    };
  }

  /** Productivity per investigator over a period — the workload report. */
  async investigatorProductivity(tenantId: string, from?: string, to?: string) {
    const period = this.periodOrDefault(from, to);

    const [assigned, completed, investigators] = await Promise.all([
      this.prisma.investigation.groupBy({
        by: ['investigatorId'],
        where: {
          tenantId,
          deletedAt: null,
          assignedAt: { gte: period.from, lte: period.to },
          investigatorId: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.investigation.groupBy({
        by: ['investigatorId'],
        where: {
          tenantId,
          deletedAt: null,
          completedAt: { gte: period.from, lte: period.to },
          investigatorId: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.investigator.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          status: true,
          qualityScore: true,
          avgTatMinutes: true,
        },
      }),
    ]);

    const assignedBy = new Map(
      assigned.map((r) => [r.investigatorId!, r._count._all]),
    );
    const completedBy = new Map(
      completed.map((r) => [r.investigatorId!, r._count._all]),
    );

    return investigators
      .map((investigator) => {
        const assignedCount = assignedBy.get(investigator.id) ?? 0;
        const completedCount = completedBy.get(investigator.id) ?? 0;
        return {
          ...investigator,
          qualityScore: investigator.qualityScore
            ? Number(investigator.qualityScore)
            : null,
          assigned: assignedCount,
          completed: completedCount,
          completionRate:
            assignedCount > 0
              ? Math.round((completedCount / assignedCount) * 100)
              : null,
        };
      })
      .sort((a, b) => b.completed - a.completed);
  }

  /** Names for the ids a groupBy returns, so charts have labels. */
  private async nameLookup(
    model: 'investigationType' | 'product' | 'governorate',
    ids: string[],
  ): Promise<Map<string, { code?: string; nameAr: string; nameEn: string }>> {
    if (ids.length === 0) return new Map();

    const rows =
      model === 'investigationType'
        ? await this.prisma.investigationType.findMany({
            where: { id: { in: ids } },
            select: { id: true, code: true, nameAr: true, nameEn: true },
          })
        : model === 'product'
          ? await this.prisma.product.findMany({
              where: { id: { in: ids } },
              select: { id: true, code: true, nameAr: true, nameEn: true },
            })
          : await this.prisma.governorate.findMany({
              where: { id: { in: ids } },
              select: { id: true, code: true, nameAr: true, nameEn: true },
            });

    return new Map(
      rows.map((row) => [
        row.id,
        { code: row.code, nameAr: row.nameAr, nameEn: row.nameEn },
      ]),
    );
  }
}
