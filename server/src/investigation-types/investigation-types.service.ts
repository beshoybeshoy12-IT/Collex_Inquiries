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
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import {
  CreateInvestigationTypeDto,
  UpdateInvestigationTypeDto,
} from './dto/investigation-type.dto';

/**
 * Investigation types — RESIDENCE, WORKPLACE, KYC — are rows, not an enum.
 *
 * The brief is explicit that these must not be hard-coded, and the consequence
 * runs deeper than a settings screen: because a type is a row, it can carry its
 * own form template, its own report template and its own required photo
 * categories, so adding "Vehicle Verification" is configuration rather than a
 * release.
 *
 * As with products, `code` is immutable: it is what a saved import mapping
 * writes into a row and what an investigator's qualification list stores.
 */
@Injectable()
export class InvestigationTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    tenantId: string,
    query: PaginationQueryDto & { activeOnly?: boolean },
  ) {
    const where: Prisma.InvestigationTypeWhereInput = {
      tenantId,
      ...(query.activeOnly ? { isActive: true } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { nameAr: { contains: query.search } },
              { nameEn: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.investigationType.findMany({
        where,
        include: {
          formTemplate: {
            select: {
              id: true,
              code: true,
              nameEn: true,
              publishedVersionId: true,
            },
          },
          reportTemplate: { select: { id: true, code: true, nameEn: true } },
          _count: { select: { investigations: true, products: true } },
        },
        orderBy: query.orderBy(['nameEn', 'code', 'createdAt'], 'nameEn'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.investigationType.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.limit);
  }

  async findOne(tenantId: string, id: string) {
    const type = await this.prisma.investigationType.findFirst({
      where: { tenantId, id },
      include: {
        formTemplate: {
          include: { versions: { orderBy: { version: 'desc' }, take: 5 } },
        },
        reportTemplate: true,
        products: {
          include: {
            product: { select: { id: true, code: true, nameEn: true } },
          },
        },
      },
    });
    if (!type) {
      throw new NotFoundException(
        'نوع التحقيق غير موجود - Investigation type not found',
      );
    }
    return type;
  }

  async create(tenantId: string, dto: CreateInvestigationTypeDto) {
    const clash = await this.prisma.investigationType.findFirst({
      where: { tenantId, code: dto.code },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        'كود نوع التحقيق مستخدم بالفعل - Investigation type code is already in use',
      );
    }

    const type = await this.prisma.investigationType.create({
      data: { tenantId, ...dto },
    });

    await this.audit.log({
      tenantId,
      action: 'INVESTIGATION_TYPE_CREATED',
      category: 'SETTINGS',
      entityType: 'InvestigationType',
      entityId: type.id,
      entityLabel: type.code,
      newValue: { code: type.code, nameEn: type.nameEn },
    });

    return type;
  }

  async update(tenantId: string, id: string, dto: UpdateInvestigationTypeDto) {
    const existing = await this.prisma.investigationType.findFirst({
      where: { tenantId, id },
    });
    if (!existing) {
      throw new NotFoundException(
        'نوع التحقيق غير موجود - Investigation type not found',
      );
    }

    if (dto.code && dto.code !== existing.code) {
      throw new BadRequestException(
        'لا يمكن تغيير كود نوع التحقيق بعد إنشائه - ' +
          'An investigation type code cannot be changed after creation',
      );
    }

    // Changing the form template only affects cases assigned from now on:
    // every case pins its own `formVersionId` at assignment, so historical work
    // keeps the questions it was actually asked.
    const updated = await this.prisma.investigationType.update({
      where: { id },
      data: dto,
    });

    const { oldValue, newValue } = this.audit.diff(
      existing,
      dto as Record<string, unknown>,
    );

    await this.audit.log({
      tenantId,
      action: 'INVESTIGATION_TYPE_UPDATED',
      category: 'SETTINGS',
      entityType: 'InvestigationType',
      entityId: id,
      entityLabel: existing.code,
      oldValue,
      newValue,
    });

    return updated;
  }

  async remove(tenantId: string, id: string) {
    const type = await this.prisma.investigationType.findFirst({
      where: { tenantId, id },
      include: { _count: { select: { investigations: true } } },
    });
    if (!type) {
      throw new NotFoundException(
        'نوع التحقيق غير موجود - Investigation type not found',
      );
    }

    if (type._count.investigations > 0) {
      await this.prisma.investigationType.update({
        where: { id },
        data: { isActive: false },
      });
      await this.audit.log({
        tenantId,
        action: 'INVESTIGATION_TYPE_DEACTIVATED',
        category: 'SETTINGS',
        severity: 'NOTICE',
        entityType: 'InvestigationType',
        entityId: id,
        entityLabel: type.code,
      });
      return {
        deleted: false,
        deactivated: true,
        message:
          `النوع مستخدم في ${type._count.investigations} تحقيق، تم تعطيله بدلاً من حذفه - ` +
          `Type is used by ${type._count.investigations} case(s); it was deactivated instead of deleted`,
      };
    }

    await this.prisma.investigationType.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      action: 'INVESTIGATION_TYPE_DELETED',
      category: 'SETTINGS',
      severity: 'WARNING',
      entityType: 'InvestigationType',
      entityId: id,
      entityLabel: type.code,
    });

    return { deleted: true, deactivated: false };
  }
}
