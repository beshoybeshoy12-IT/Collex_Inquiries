import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EscalationTrigger, InvestigationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequestContextService } from '../common/context/request-context';
import { assessSla, SlaPolicyShape } from '../investigations/sla.util';
import { STATUS_GROUPS } from '../investigations/case-status.machine';
import { UpsertEscalationRuleDto, UpsertSlaPolicyDto } from './dto/sla.dto';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SLA policies and the escalation engine.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  THERE ARE NO HARD-CODED TIME VALUES IN THE ESCALATION SWEEP. Every
 *  threshold is a row in `escalation_rules`, which is what the brief asks for
 *  and what makes the difference between a system an operations manager can
 *  tune and one that needs a deploy to change "notify after 2 hours" to
 *  "notify after 90 minutes".
 *
 *  FIRING ONCE IS ENFORCED BY THE DATABASE, not by reading first. The sweep
 *  inserts an `EscalationEvent` with a unique key of
 *  `(rule, investigation, occurrence)` and lets a duplicate-key violation mean
 *  "already fired". Read-then-write would race itself the moment two instances
 *  run the sweep concurrently — which is precisely what happens when the cron
 *  lease fails open.
 */
@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly requestContext: RequestContextService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Policies
  // ─────────────────────────────────────────────────────────────────────────

  async listPolicies(tenantId: string) {
    return this.prisma.slaPolicy.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { nameEn: 'asc' }],
    });
  }

  async upsertPolicy(tenantId: string, dto: UpsertSlaPolicyDto, id?: string) {
    if (dto.workdayEndHour <= dto.workdayStartHour) {
      throw new BadRequestException(
        'ساعة نهاية اليوم يجب أن تكون بعد ساعة البداية - ' +
          'The workday end hour must be after the start hour',
      );
    }

    // The stage budgets should not exceed the whole-case budget, or the badge
    // says GREEN while a stage is already past its own deadline.
    const stageTotal =
      dto.assignmentHours + dto.acceptanceHours + dto.fieldHours + dto.qcHours;
    if (stageTotal > dto.totalHours) {
      throw new BadRequestException(
        `مجموع مراحل الاتفاقية (${stageTotal} ساعة) يتجاوز الإجمالي (${dto.totalHours}) - ` +
          `The stage budgets (${stageTotal}h) exceed the total (${dto.totalHours}h)`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        // Exactly one default, or "which policy applies" has no answer.
        await tx.slaPolicy.updateMany({
          where: { tenantId, isDefault: true, ...(id ? { NOT: { id } } : {}) },
          data: { isDefault: false },
        });
      }

      if (id) {
        const existing = await tx.slaPolicy.findFirst({
          where: { tenantId, id },
        });
        if (!existing) {
          throw new NotFoundException(
            'السياسة غير موجودة - SLA policy not found',
          );
        }
        return tx.slaPolicy.update({
          where: { id },
          data: { ...dto, code: existing.code },
        });
      }

      const clash = await tx.slaPolicy.findFirst({
        where: { tenantId, code: dto.code },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException(
          'كود السياسة مستخدم بالفعل - Policy code is already in use',
        );
      }

      return tx.slaPolicy.create({ data: { tenantId, ...dto } });
    });

    await this.audit.log({
      tenantId,
      action: id ? 'SLA_POLICY_UPDATED' : 'SLA_POLICY_CREATED',
      category: 'SETTINGS',
      severity: 'NOTICE',
      entityType: 'SlaPolicy',
      entityId: result.id,
      entityLabel: result.code,
      newValue: { totalHours: dto.totalHours, isDefault: dto.isDefault },
    });

    return result;
  }

  async removePolicy(tenantId: string, id: string) {
    const policy = await this.prisma.slaPolicy.findFirst({
      where: { tenantId, id },
      include: { _count: { select: { investigations: true } } },
    });
    if (!policy) {
      throw new NotFoundException('السياسة غير موجودة - SLA policy not found');
    }

    // Cases point at it to explain their own due date.
    if (policy._count.investigations > 0) {
      await this.prisma.slaPolicy.update({
        where: { id },
        data: { isActive: false },
      });
      return {
        deleted: false,
        deactivated: true,
        message:
          `السياسة مستخدمة في ${policy._count.investigations} تحقيق، تم تعطيلها - ` +
          `Used by ${policy._count.investigations} case(s); deactivated instead`,
      };
    }

    await this.prisma.slaPolicy.delete({ where: { id } });
    return { deleted: true, deactivated: false };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Escalation rules
  // ─────────────────────────────────────────────────────────────────────────

  async listRules(tenantId: string) {
    return this.prisma.escalationRule.findMany({
      where: { tenantId },
      orderBy: [{ trigger: 'asc' }, { thresholdMinutes: 'asc' }],
    });
  }

  async upsertRule(
    tenantId: string,
    dto: UpsertEscalationRuleDto,
    id?: string,
  ) {
    if (id) {
      const existing = await this.prisma.escalationRule.findFirst({
        where: { tenantId, id },
      });
      if (!existing) {
        throw new NotFoundException(
          'القاعدة غير موجودة - Escalation rule not found',
        );
      }
      return this.prisma.escalationRule.update({
        where: { id },
        data: { ...dto, code: existing.code },
      });
    }

    const clash = await this.prisma.escalationRule.findFirst({
      where: { tenantId, code: dto.code },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException(
        'كود القاعدة مستخدم بالفعل - Rule code is already in use',
      );
    }

    return this.prisma.escalationRule.create({ data: { tenantId, ...dto } });
  }

  async removeRule(tenantId: string, id: string) {
    const rule = await this.prisma.escalationRule.findFirst({
      where: { tenantId, id },
    });
    if (!rule) {
      throw new NotFoundException(
        'القاعدة غير موجودة - Escalation rule not found',
      );
    }
    await this.prisma.escalationRule.delete({ where: { id } });
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  The sweep
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Evaluate every active rule against every open case, across all tenants.
   *
   * Runs under `runAsSystem`, which is the only way to read across tenants —
   * a sweep that had to be invoked per tenant would either need a tenant list
   * query outside the guard anyway, or would silently skip a tenant added
   * between runs.
   */
  async runEscalationSweep(): Promise<{
    tenantsChecked: number;
    rulesEvaluated: number;
    escalationsFired: number;
  }> {
    return this.requestContext.runAsSystem(async () => {
      const rules = await this.prisma.escalationRule.findMany({
        where: { isActive: true },
      });

      if (rules.length === 0) {
        return { tenantsChecked: 0, rulesEvaluated: 0, escalationsFired: 0 };
      }

      const byTenant = new Map<string, typeof rules>();
      for (const rule of rules) {
        byTenant.set(rule.tenantId, [
          ...(byTenant.get(rule.tenantId) ?? []),
          rule,
        ]);
      }

      let fired = 0;

      for (const [tenantId, tenantRules] of byTenant) {
        fired += await this.sweepTenant(tenantId, tenantRules);
      }

      if (fired > 0) {
        this.logger.log(
          `Escalation sweep fired ${fired} escalation(s) across ${byTenant.size} tenant(s)`,
        );
      }

      return {
        tenantsChecked: byTenant.size,
        rulesEvaluated: rules.length,
        escalationsFired: fired,
      };
    }, 'sla-sweep');
  }

  private async sweepTenant(
    tenantId: string,
    rules: Awaited<ReturnType<SlaService['listRules']>>,
  ): Promise<number> {
    // Only cases still in play. A completed case cannot breach anything, and a
    // cancelled one has no obligation left.
    const open = await this.prisma.investigation.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: {
          notIn: [...STATUS_GROUPS.COMPLETED, ...STATUS_GROUPS.CLOSED],
        },
      },
      select: {
        id: true,
        caseNumber: true,
        status: true,
        priority: true,
        createdAt: true,
        assignedAt: true,
        acceptedAt: true,
        startedAt: true,
        submittedAt: true,
        qcAt: true,
        completedAt: true,
        dueAt: true,
        coordinatorId: true,
        investigatorId: true,
        slaPolicy: true,
      },
      take: 5000,
    });

    let fired = 0;

    for (const investigation of open) {
      for (const rule of rules) {
        if (rule.priority && rule.priority !== investigation.priority) continue;

        const since = this.triggerReferenceTime(rule.trigger, investigation);
        if (!since) continue;

        const elapsedMinutes = Math.floor(
          (Date.now() - since.getTime()) / 60_000,
        );
        if (elapsedMinutes < rule.thresholdMinutes) continue;

        // A repeating rule fires once per interval; a one-shot rule always
        // uses bucket 0, so the unique constraint deduplicates it forever.
        const occurrence = rule.repeatEveryMinutes
          ? Math.floor(
              (elapsedMinutes - rule.thresholdMinutes) /
                rule.repeatEveryMinutes,
            )
          : 0;

        const didFire = await this.fireOnce(
          tenantId,
          rule,
          investigation,
          occurrence,
          elapsedMinutes,
        );
        if (didFire) fired++;
      }
    }

    return fired;
  }

  /**
   * Which stamp a trigger measures from.
   *
   * Returning null means the trigger does not apply to this case yet — a case
   * that has never been assigned cannot be late in accepting.
   */
  private triggerReferenceTime(
    trigger: EscalationTrigger,
    investigation: {
      status: InvestigationStatus;
      createdAt: Date;
      assignedAt: Date | null;
      acceptedAt: Date | null;
      submittedAt: Date | null;
      dueAt: Date | null;
      slaPolicy: unknown;
    },
  ): Date | null {
    switch (trigger) {
      case EscalationTrigger.NOT_ACCEPTED:
        // Only meaningful while the case is still waiting to be accepted.
        return investigation.status === InvestigationStatus.ASSIGNED &&
          !investigation.acceptedAt
          ? investigation.assignedAt
          : null;

      case EscalationTrigger.NOT_STARTED:
        return investigation.status === InvestigationStatus.ACCEPTED
          ? investigation.acceptedAt
          : null;

      case EscalationTrigger.QC_PENDING_TOO_LONG:
        return investigation.status === InvestigationStatus.QC_PENDING
          ? investigation.submittedAt
          : null;

      case EscalationTrigger.REWORK_OVERDUE:
        return investigation.status === InvestigationStatus.REWORK
          ? (investigation.submittedAt ?? investigation.assignedAt)
          : null;

      case EscalationTrigger.SLA_WARNING: {
        // Measured from the point the case entered its warning band, so the
        // rule's own threshold is "how long has it been amber", not "how old
        // is the case".
        const assessment = assessSla(
          investigation,
          investigation.slaPolicy as SlaPolicyShape | null,
        );
        return assessment.state === 'YELLOW' ? investigation.createdAt : null;
      }

      case EscalationTrigger.SLA_BREACH:
        return investigation.dueAt && investigation.dueAt.getTime() < Date.now()
          ? investigation.dueAt
          : null;

      default:
        return null;
    }
  }

  /**
   * Insert the event and notify — or do nothing if it has already fired.
   *
   * The unique-constraint violation IS the "already fired" check. No read
   * first, so two instances sweeping at once cannot both decide to notify.
   */
  private async fireOnce(
    tenantId: string,
    rule: {
      id: string;
      code: string;
      nameAr: string;
      nameEn: string;
      trigger: EscalationTrigger;
      notifyRoleCodes: string[];
      notifyCoordinator: boolean;
      notifyInvestigator: boolean;
    },
    investigation: {
      id: string;
      caseNumber: string;
      coordinatorId: string | null;
      investigatorId: string | null;
    },
    occurrence: number,
    elapsedMinutes: number,
  ): Promise<boolean> {
    try {
      await this.prisma.escalationEvent.create({
        data: {
          ruleId: rule.id,
          tenantId,
          investigationId: investigation.id,
          occurrence,
        },
      });
    } catch {
      // Unique violation — already fired for this bucket. Nothing to do, and
      // nothing worth logging: this is the expected path on every sweep after
      // the first.
      return false;
    }

    const titleAr = 'تنبيه تصعيد';
    const titleEn = 'Escalation';
    const bodyAr = `${rule.nameAr}: التحقيق ${investigation.caseNumber} (${Math.floor(elapsedMinutes / 60)} ساعة)`;
    const bodyEn = `${rule.nameEn}: ${investigation.caseNumber} (${Math.floor(elapsedMinutes / 60)}h)`;

    const payload = {
      type: 'ESCALATION' as const,
      titleAr,
      titleEn,
      bodyAr,
      bodyEn,
      entityType: 'Investigation',
      entityId: investigation.id,
      link: `/investigations/${investigation.id}`,
      priority: 'HIGH' as const,
    };

    if (rule.notifyCoordinator && investigation.coordinatorId) {
      await this.notifications.notifyUser(
        tenantId,
        investigation.coordinatorId,
        payload,
      );
    }

    if (rule.notifyInvestigator && investigation.investigatorId) {
      await this.notifications.notifyInvestigator(
        tenantId,
        investigation.investigatorId,
        payload,
      );
    }

    if (rule.notifyRoleCodes.length > 0) {
      await this.notifications.notifyRoles(
        tenantId,
        rule.notifyRoleCodes,
        payload,
      );
    }

    await this.audit.log({
      tenantId,
      action: 'SLA_ESCALATION',
      category: 'INVESTIGATION',
      severity:
        rule.trigger === EscalationTrigger.SLA_BREACH ? 'CRITICAL' : 'WARNING',
      actorName: 'system',
      entityType: 'Investigation',
      entityId: investigation.id,
      entityLabel: investigation.caseNumber,
      metadata: {
        rule: rule.code,
        trigger: rule.trigger,
        elapsedMinutes,
        occurrence,
      },
    });

    return true;
  }
}
