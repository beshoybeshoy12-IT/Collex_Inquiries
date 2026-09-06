import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { paginate } from '../common/interfaces/api.interface';
import { P } from '../common/constants/permissions';
import {
  RequirePermission,
  TenantId,
} from '../common/decorators/auth.decorators';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuditCategory })
  @IsOptional()
  @IsIn(Object.values(AuditCategory))
  category?: AuditCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  actorId?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive lower bound.' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive upper bound.' })
  @IsOptional()
  @IsString()
  to?: string;
}

/**
 * `/api/v1/audit` — read-only, deliberately.
 *
 * There is no POST, PATCH or DELETE here and there is no service method that
 * would back one. An audit trail a user can edit is not an audit trail, and
 * the only way rows leave this table is the dated retention sweep.
 */
@ApiTags('audit')
@ApiBearerAuth()
@Controller({ path: 'audit', version: '1' })
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission(P.AUDIT_VIEW)
  @ApiOperation({ summary: 'Search the audit trail' })
  async findAll(@TenantId() tenantId: string, @Query() query: AuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      ...(query.category ? { category: query.category } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { actorName: { contains: query.search, mode: 'insensitive' } },
              { entityLabel: { contains: query.search, mode: 'insensitive' } },
              { action: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: query.orderBy(
          ['createdAt', 'action', 'category'],
          'createdAt',
        ),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.limit);
  }

  /** The trail for one record — what the case's Audit tab renders. */
  @Get('entity/:entityType/:entityId')
  @RequirePermission(P.AUDIT_VIEW)
  @ApiOperation({ summary: 'The audit trail for one entity' })
  async forEntity(
    @TenantId() tenantId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const where: Prisma.AuditLogWhereInput = { tenantId, entityType, entityId };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.limit);
  }
}
