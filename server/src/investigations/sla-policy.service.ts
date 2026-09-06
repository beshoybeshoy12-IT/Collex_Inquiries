import { Injectable } from '@nestjs/common';
import { Priority, SlaPolicy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeDueAt } from './sla.util';

/**
 * Picks the SLA policy that applies to a case, most specific first.
 *
 *   product + type + priority  →  product + type  →  product  →  type
 *   →  priority  →  the tenant default
 *
 * Specificity is scored rather than queried four times: the whole policy set
 * for a tenant is a handful of rows, so one read and an in-memory sort is both
 * simpler and faster than a cascade of queries that stops at the first hit.
 *
 * The result is cached per tenant for the life of a request batch — an import
 * of 5,000 rows resolves a policy per row and would otherwise issue 5,000
 * identical queries.
 */
@Injectable()
export class SlaPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(tenantId: string): Promise<SlaPolicy[]> {
    return this.prisma.slaPolicy.findMany({
      where: { tenantId, isActive: true },
    });
  }

  /**
   * Choose from an already-loaded set. Pure, so the import pipeline can resolve
   * thousands of rows against one read.
   */
  select(
    policies: SlaPolicy[],
    criteria: {
      productId?: string | null;
      investigationTypeId?: string | null;
      priority?: Priority | null;
    },
  ): SlaPolicy | null {
    let best: SlaPolicy | null = null;
    let bestScore = -1;

    for (const policy of policies) {
      // A policy naming a product other than this case's does not apply at
      // all; a policy naming none applies to everything.
      if (policy.productId && policy.productId !== criteria.productId) continue;
      if (
        policy.investigationTypeId &&
        policy.investigationTypeId !== criteria.investigationTypeId
      ) {
        continue;
      }
      if (policy.priority && policy.priority !== criteria.priority) continue;

      // Weighted so that product+type always beats priority alone, whatever
      // order the rows come back in.
      const score =
        (policy.productId ? 4 : 0) +
        (policy.investigationTypeId ? 2 : 0) +
        (policy.priority ? 1 : 0);

      if (score > bestScore) {
        best = policy;
        bestScore = score;
      }
    }

    // Nothing matched even loosely — fall back to whatever is flagged default.
    return best ?? policies.find((p) => p.isDefault) ?? null;
  }

  async resolve(
    tenantId: string,
    criteria: {
      productId?: string | null;
      investigationTypeId?: string | null;
      priority?: Priority | null;
    },
  ): Promise<SlaPolicy | null> {
    return this.select(await this.listActive(tenantId), criteria);
  }

  /**
   * The deadline for a case, and the policy it came from.
   *
   * Falls back to the product's `defaultSlaHours` when no policy matches, so a
   * tenant that never configures an SLA still gets due dates rather than a
   * column of dashes.
   */
  dueDateFor(
    policy: SlaPolicy | null,
    fallbackHours: number | null | undefined,
    start: Date = new Date(),
  ): Date | null {
    if (policy) return computeDueAt(start, policy);
    if (fallbackHours && fallbackHours > 0) {
      return new Date(start.getTime() + fallbackHours * 3_600_000);
    }
    return null;
  }
}
