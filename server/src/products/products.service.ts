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
  CreateProductDto,
  SetProductTypesDto,
  UpdateProductDto,
} from './dto/product.dto';

/**
 * Products are configuration, not code.
 *
 * Nothing in this codebase branches on a product name — the seeder ships
 * "Personal Loan" and "Credit Card" as *rows*, and a tenant that finances
 * tractors adds a row. `code` is the stable identifier and `nameAr`/`nameEn`
 * are display only, which is why the code is immutable after creation: it is
 * what a saved import mapping and an SLA policy point at, and letting it change
 * would silently detach both.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    tenantId: string,
    query: PaginationQueryDto & { activeOnly?: boolean },
  ) {
    const where: Prisma.ProductWhereInput = {
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
      this.prisma.product.findMany({
        where,
        include: {
          investigationTypes: {
            include: {
              investigationType: {
                select: { id: true, code: true, nameAr: true, nameEn: true },
              },
            },
          },
          reportTemplate: { select: { id: true, code: true, nameEn: true } },
          _count: { select: { investigations: true } },
        },
        orderBy: query.orderBy(['nameEn', 'code', 'createdAt'], 'nameEn'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.limit);
  }

  async findOne(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { tenantId, id },
      include: {
        investigationTypes: {
          include: { investigationType: true },
        },
        reportTemplate: true,
      },
    });
    if (!product) {
      throw new NotFoundException('المنتج غير موجود - Product not found');
    }
    return product;
  }

  async create(tenantId: string, dto: CreateProductDto) {
    const clash = await this.prisma.product.findFirst({
      where: { tenantId, code: dto.code },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        'كود المنتج مستخدم بالفعل - Product code is already in use',
      );
    }

    const { investigationTypeIds, ...data } = dto;

    const product = await this.prisma.product.create({
      data: {
        tenantId,
        ...data,
        ...(investigationTypeIds?.length
          ? {
              investigationTypes: {
                create: investigationTypeIds.map((investigationTypeId) => ({
                  investigationTypeId,
                })),
              },
            }
          : {}),
      },
      include: { investigationTypes: true },
    });

    await this.audit.log({
      tenantId,
      action: 'PRODUCT_CREATED',
      category: 'SETTINGS',
      entityType: 'Product',
      entityId: product.id,
      entityLabel: product.code,
      newValue: { code: product.code, nameEn: product.nameEn },
    });

    return product;
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findFirst({
      where: { tenantId, id },
    });
    if (!existing) {
      throw new NotFoundException('المنتج غير موجود - Product not found');
    }

    // `code` is what mappings, SLA policies and historical reports point at.
    if (dto.code && dto.code !== existing.code) {
      throw new BadRequestException(
        'لا يمكن تغيير كود المنتج بعد إنشائه - ' +
          'A product code cannot be changed after creation',
      );
    }

    const { investigationTypeIds: _ignored, ...data } = dto;

    const updated = await this.prisma.product.update({
      where: { id },
      data,
      include: { investigationTypes: { include: { investigationType: true } } },
    });

    const { oldValue, newValue } = this.audit.diff(existing, data);

    await this.audit.log({
      tenantId,
      action: 'PRODUCT_UPDATED',
      category: 'SETTINGS',
      entityType: 'Product',
      entityId: id,
      entityLabel: existing.code,
      oldValue,
      newValue,
    });

    return updated;
  }

  /**
   * Replace the set of investigation types this product allows.
   *
   * A pairing that is in use is deactivated rather than deleted: existing cases
   * point at it for their SLA and price, and removing the row would leave them
   * unable to explain their own due date.
   */
  async setInvestigationTypes(
    tenantId: string,
    id: string,
    dto: SetProductTypesDto,
  ) {
    await this.findOne(tenantId, id);

    const types = await this.prisma.investigationType.findMany({
      where: {
        tenantId,
        id: { in: dto.investigationTypes.map((t) => t.investigationTypeId) },
      },
      select: { id: true },
    });
    if (types.length !== dto.investigationTypes.length) {
      throw new BadRequestException(
        'أحد أنواع التحقيق غير موجود - One of the investigation types does not exist',
      );
    }

    const wanted = new Set(
      dto.investigationTypes.map((t) => t.investigationTypeId),
    );

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.productInvestigationType.findMany({
        where: { productId: id },
      });

      for (const pairing of current) {
        if (!wanted.has(pairing.investigationTypeId)) {
          const inUse = await tx.investigation.count({
            where: {
              tenantId,
              productId: id,
              investigationTypeId: pairing.investigationTypeId,
            },
          });

          if (inUse > 0) {
            await tx.productInvestigationType.update({
              where: {
                productId_investigationTypeId: {
                  productId: id,
                  investigationTypeId: pairing.investigationTypeId,
                },
              },
              data: { isActive: false },
            });
          } else {
            await tx.productInvestigationType.delete({
              where: {
                productId_investigationTypeId: {
                  productId: id,
                  investigationTypeId: pairing.investigationTypeId,
                },
              },
            });
          }
        }
      }

      for (const entry of dto.investigationTypes) {
        await tx.productInvestigationType.upsert({
          where: {
            productId_investigationTypeId: {
              productId: id,
              investigationTypeId: entry.investigationTypeId,
            },
          },
          create: {
            productId: id,
            investigationTypeId: entry.investigationTypeId,
            slaHours: entry.slaHours,
            price: entry.price,
            isActive: true,
          },
          update: {
            slaHours: entry.slaHours,
            price: entry.price,
            isActive: true,
          },
        });
      }
    });

    await this.audit.log({
      tenantId,
      action: 'PRODUCT_TYPES_UPDATED',
      category: 'SETTINGS',
      entityType: 'Product',
      entityId: id,
      newValue: { investigationTypes: [...wanted] },
    });

    return this.findOne(tenantId, id);
  }

  /**
   * Deactivate rather than delete once a product has been used.
   *
   * Deleting would orphan every historical case's product reference, and those
   * cases are the record of work that was billed.
   */
  async remove(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { tenantId, id },
      include: { _count: { select: { investigations: true } } },
    });
    if (!product) {
      throw new NotFoundException('المنتج غير موجود - Product not found');
    }

    if (product._count.investigations > 0) {
      const updated = await this.prisma.product.update({
        where: { id },
        data: { isActive: false },
      });
      await this.audit.log({
        tenantId,
        action: 'PRODUCT_DEACTIVATED',
        category: 'SETTINGS',
        severity: 'NOTICE',
        entityType: 'Product',
        entityId: id,
        entityLabel: product.code,
      });
      return {
        deleted: false,
        deactivated: true,
        product: updated,
        message:
          `المنتج مستخدم في ${product._count.investigations} تحقيق، تم تعطيله بدلاً من حذفه - ` +
          `Product is used by ${product._count.investigations} case(s); it was deactivated instead of deleted`,
      };
    }

    await this.prisma.product.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      action: 'PRODUCT_DELETED',
      category: 'SETTINGS',
      severity: 'WARNING',
      entityType: 'Product',
      entityId: id,
      entityLabel: product.code,
    });

    return { deleted: true, deactivated: false };
  }
}
