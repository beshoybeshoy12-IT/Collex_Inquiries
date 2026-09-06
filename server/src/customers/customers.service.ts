import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/interfaces/api.interface';
import {
  CreateCustomerDto,
  CustomerQueryDto,
  MergeCustomersDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';
import { comparablePhone } from '../common/utils/phone.util';

const GEO_SELECT = { select: { id: true, nameAr: true, nameEn: true } };

/**
 * Customers are an identity, not a copy of a spreadsheet row.
 *
 * A person investigated three times over two years is one row here with three
 * investigations hanging off it — which is what makes the Customer 360 screen
 * possible and what stops the same national id existing under four spellings
 * of the same name.
 *
 * The `[tenantId, nationalId]` unique constraint is the backbone of that. It
 * is a *partial* uniqueness in practice: Postgres treats NULLs as distinct, so
 * any number of customers may have no national id — which is correct, because
 * plenty of bank files carry none and refusing them would block real work.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(tenantId: string, query: CustomerQueryDto) {
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.governorateId ? { governorateId: query.governorateId } : {}),
      ...(query.cityId ? { cityId: query.cityId } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { nationalId: { contains: query.search } },
              { mobile: { contains: query.search } },
              { altMobile: { contains: query.search } },
              {
                workplaceName: { contains: query.search, mode: 'insensitive' },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: {
          governorate: GEO_SELECT,
          city: GEO_SELECT,
          _count: { select: { investigations: true } },
        },
        orderBy: query.orderBy(
          ['createdAt', 'fullName', 'updatedAt'],
          'createdAt',
        ),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.limit);
  }

  /**
   * Customer 360 — the profile plus their whole case history.
   *
   * One query with the cases included rather than a separate list endpoint the
   * client then has to join: this screen is always rendered whole.
   */
  async findOne(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { tenantId, id, deletedAt: null },
      include: {
        governorate: GEO_SELECT,
        city: GEO_SELECT,
        district: GEO_SELECT,
        area: GEO_SELECT,
        investigations: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: {
            product: {
              select: { id: true, code: true, nameAr: true, nameEn: true },
            },
            investigationType: {
              select: { id: true, code: true, nameAr: true, nameEn: true },
            },
            investigator: { select: { id: true, fullName: true } },
            reports: {
              where: { status: 'READY' },
              orderBy: { version: 'desc' },
              take: 1,
              select: {
                id: true,
                version: true,
                fileName: true,
                isFinal: true,
              },
            },
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('العميل غير موجود - Customer not found');
    }

    return customer;
  }

  async create(
    tenantId: string,
    user: AuthenticatedUser,
    dto: CreateCustomerDto,
  ) {
    if (dto.nationalId) {
      const clash = await this.prisma.customer.findFirst({
        where: { tenantId, nationalId: dto.nationalId, deletedAt: null },
        select: { id: true, fullName: true },
      });
      if (clash) {
        throw new ConflictException({
          message:
            'يوجد عميل بنفس الرقم القومي - A customer with this national id already exists',
          errorCode: 'DUPLICATE_NATIONAL_ID',
          existing: clash,
        });
      }
    }

    const customer = await this.prisma.customer.create({
      data: { tenantId, ...dto, createdById: user.id },
    });

    await this.audit.log({
      tenantId,
      action: 'CUSTOMER_CREATED',
      category: 'CUSTOMER',
      entityType: 'Customer',
      entityId: customer.id,
      entityLabel: customer.fullName,
      newValue: { fullName: dto.fullName, nationalId: dto.nationalId },
    });

    return customer;
  }

  async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    const existing = await this.prisma.customer.findFirst({
      where: { tenantId, id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('العميل غير موجود - Customer not found');
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: dto,
    });

    const { oldValue, newValue } = this.audit.diff(
      existing,
      dto as Record<string, unknown>,
    );

    await this.audit.log({
      tenantId,
      action: 'CUSTOMER_UPDATED',
      category: 'CUSTOMER',
      entityType: 'Customer',
      entityId: id,
      entityLabel: existing.fullName,
      oldValue,
      newValue,
    });

    return updated;
  }

  /**
   * Soft delete, and only for a customer with no cases.
   *
   * A customer with investigations is referenced by evidence, reports and audit
   * rows; deleting them would leave a case whose subject is unknowable. The
   * refusal names the count so the user knows what to do about it.
   */
  async remove(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { tenantId, id, deletedAt: null },
      include: { _count: { select: { investigations: true } } },
    });
    if (!customer) {
      throw new NotFoundException('العميل غير موجود - Customer not found');
    }

    if (customer._count.investigations > 0) {
      throw new BadRequestException(
        `لا يمكن حذف عميل مرتبط بـ ${customer._count.investigations} تحقيق - ` +
          `Cannot delete a customer with ${customer._count.investigations} investigation(s)`,
      );
    }

    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      tenantId,
      action: 'CUSTOMER_DELETED',
      category: 'CUSTOMER',
      severity: 'WARNING',
      entityType: 'Customer',
      entityId: id,
      entityLabel: customer.fullName,
    });

    return { success: true };
  }

  /**
   * Fold a duplicate into the record that should survive.
   *
   * Cases and media move across, then the loser is soft-deleted rather than
   * removed: an audit row from last year names it, and a hard delete would
   * leave that row pointing at nothing.
   *
   * Fields on the survivor are only filled in where they are empty — a merge
   * must never overwrite a value somebody verified with one from a record they
   * decided was wrong.
   */
  async merge(tenantId: string, dto: MergeCustomersDto) {
    if (dto.keepId === dto.mergeId) {
      throw new BadRequestException(
        'لا يمكن دمج العميل مع نفسه - Cannot merge a customer into itself',
      );
    }

    const [keep, merge] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { tenantId, id: dto.keepId, deletedAt: null },
      }),
      this.prisma.customer.findFirst({
        where: { tenantId, id: dto.mergeId, deletedAt: null },
      }),
    ]);

    if (!keep || !merge) {
      throw new NotFoundException('العميل غير موجود - Customer not found');
    }

    const filled: Record<string, unknown> = {};
    for (const field of [
      'nationalId',
      'mobile',
      'altMobile',
      'homePhone',
      'email',
      'residenceAddress',
      'workplaceName',
      'workplacePhone',
      'workplaceAddress',
      'jobTitle',
      'governorateId',
      'cityId',
      'districtId',
      'areaId',
    ] as const) {
      if (!keep[field] && merge[field]) filled[field] = merge[field];
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.investigation.updateMany({
        where: { tenantId, customerId: merge.id },
        data: { customerId: keep.id },
      });

      await tx.mediaAsset.updateMany({
        where: { tenantId, customerId: merge.id },
        data: { customerId: keep.id },
      });

      const survivor = await tx.customer.update({
        where: { id: keep.id },
        data: filled,
      });

      await tx.customer.update({
        where: { id: merge.id },
        data: {
          deletedAt: new Date(),
          // Left behind so the merge is discoverable from the losing row.
          notes:
            `${merge.notes ?? ''}\n[merged into ${keep.id} on ${new Date().toISOString()}]`.trim(),
        },
      });

      return { survivor, movedInvestigations: moved.count };
    });

    await this.audit.log({
      tenantId,
      action: 'CUSTOMER_MERGED',
      category: 'CUSTOMER',
      severity: 'NOTICE',
      entityType: 'Customer',
      entityId: keep.id,
      entityLabel: keep.fullName,
      oldValue: { mergedId: merge.id, mergedName: merge.fullName },
      newValue: {
        filledFields: Object.keys(filled),
        movedInvestigations: result.movedInvestigations,
      },
    });

    return result;
  }

  /**
   * Possible duplicates of a candidate, without creating anything.
   *
   * Used by the manual-entry screen before it saves and by the import preview.
   * The rules are ordered by how conclusive they are — a national id match is
   * an identity; a name match is a suggestion.
   */
  async findPotentialDuplicates(
    tenantId: string,
    candidate: {
      nationalId?: string | null;
      mobile?: string | null;
      fullName?: string | null;
    },
  ) {
    const matches: {
      rule: string;
      confidence: 'HIGH' | 'MEDIUM' | 'LOW';
      customer: {
        id: string;
        fullName: string;
        nationalId: string | null;
        mobile: string | null;
      };
    }[] = [];

    const select = {
      id: true,
      fullName: true,
      nationalId: true,
      mobile: true,
    };

    if (candidate.nationalId) {
      const byId = await this.prisma.customer.findMany({
        where: { tenantId, nationalId: candidate.nationalId, deletedAt: null },
        select,
      });
      matches.push(
        ...byId.map((customer) => ({
          rule: 'NATIONAL_ID',
          confidence: 'HIGH' as const,
          customer,
        })),
      );
    }

    if (candidate.mobile) {
      // Compared on the last nine digits, so the same handset written as
      // 01001234567, +201001234567 and 00201001234567 matches itself.
      const tail = comparablePhone(candidate.mobile);
      if (tail) {
        const byPhone = await this.prisma.customer.findMany({
          where: {
            tenantId,
            deletedAt: null,
            OR: [
              { mobile: { endsWith: tail } },
              { altMobile: { endsWith: tail } },
            ],
          },
          select,
        });
        matches.push(
          ...byPhone.map((customer) => ({
            rule: 'PHONE',
            confidence: 'MEDIUM' as const,
            customer,
          })),
        );
      }
    }

    if (candidate.fullName && candidate.fullName.trim().length >= 6) {
      const byName = await this.prisma.customer.findMany({
        where: {
          tenantId,
          deletedAt: null,
          fullName: { equals: candidate.fullName.trim(), mode: 'insensitive' },
        },
        select,
        take: 10,
      });
      matches.push(
        ...byName.map((customer) => ({
          rule: 'FULL_NAME',
          confidence: 'LOW' as const,
          customer,
        })),
      );
    }

    // One customer can match on several rules; report each customer once, with
    // the strongest rule that found them.
    const best = new Map<string, (typeof matches)[number]>();
    const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
    for (const match of matches) {
      const current = best.get(match.customer.id);
      if (!current || rank[match.confidence] > rank[current.confidence]) {
        best.set(match.customer.id, match);
      }
    }

    return [...best.values()];
  }
}
