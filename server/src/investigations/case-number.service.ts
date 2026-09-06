import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Case numbers: `INQ-<tenant>-<YYMM>-<sequence>`, e.g. `INQ-DEMO-2603-000147`.
 *
 * Readable on the phone, sortable, and scoped so two tenants never collide.
 * Never supplied by a client — a case number a caller can choose is a case
 * number a caller can use to overwrite somebody else's case.
 *
 * CONCURRENCY. An import of 5,000 rows and a coordinator creating one by hand
 * can allocate at the same instant. Counting existing rows and adding one would
 * hand both the same number, and the unique constraint would fail the whole
 * import transaction. So the sequence comes from a Postgres sequence — one per
 * tenant-month, created on demand — which is atomic, never reuses a value, and
 * costs a single round trip.
 *
 * A gap in the numbering is therefore possible (a rolled-back transaction
 * consumes its number). That is the correct trade: gaps are cosmetic, and the
 * alternative is duplicates, which are not.
 */
@Injectable()
export class CaseNumberService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserve `count` consecutive numbers.
   *
   * Batched because an import allocates thousands at once and a round trip per
   * row would dominate its runtime.
   */
  async allocate(
    tenantId: string,
    tenantCode: string,
    count = 1,
    tx?: Prisma.TransactionClient,
  ): Promise<string[]> {
    const client = tx ?? this.prisma;
    const now = new Date();
    const period = `${String(now.getFullYear()).slice(2)}${String(
      now.getMonth() + 1,
    ).padStart(2, '0')}`;

    const sequenceName = this.sequenceName(tenantId, period);

    // CREATE SEQUENCE IF NOT EXISTS is atomic, so two concurrent callers on the
    // first case of a month cannot both create it.
    await client.$executeRawUnsafe(
      `CREATE SEQUENCE IF NOT EXISTS ${sequenceName} AS bigint START 1`,
    );

    const rows = await client.$queryRawUnsafe<{ nextval: bigint }[]>(
      `SELECT nextval('${sequenceName}') FROM generate_series(1, $1)`,
      count,
    );

    const prefix = this.normaliseCode(tenantCode);
    return rows.map(
      (row) =>
        `INQ-${prefix}-${period}-${String(row.nextval).padStart(6, '0')}`,
    );
  }

  async allocateOne(
    tenantId: string,
    tenantCode: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const [caseNumber] = await this.allocate(tenantId, tenantCode, 1, tx);
    return caseNumber;
  }

  /**
   * The sequence's name.
   *
   * Built from the tenant's UUID with the dashes stripped, not from its code:
   * a tenant can be renamed, and a sequence keyed on a mutable value would
   * restart numbering the moment somebody edited the company profile. The name
   * is quoted and every character in it comes from a UUID and a numeric period,
   * so nothing here reaches SQL that did not originate in the database.
   */
  private sequenceName(tenantId: string, period: string): string {
    const suffix = tenantId.replace(/-/g, '');
    return `"case_seq_${suffix}_${period}"`;
  }

  /** Tenant codes are already constrained, but never trust that at a call site. */
  private normaliseCode(code: string): string {
    return (code || 'TEN')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);
  }
}
