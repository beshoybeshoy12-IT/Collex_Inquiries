import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrincipalType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AllowPrincipals } from '../common/decorators/auth.decorators';

/**
 * `/api/v1/geography`
 *
 * Egypt's administrative hierarchy — governorate → city → district → area. A
 * SHARED catalogue, not tenant data, so there is no `tenantId` anywhere in
 * here and no permission gating reads: two agencies working the same city must
 * agree on what that city is, or coverage matching and the live map disagree
 * with each other.
 *
 * Read-only over the API. The catalogue is seeded and changes through a
 * migration, because a tenant inventing a governorate would break exactly the
 * agreement the shared catalogue exists to provide.
 */
@ApiTags('geography')
@ApiBearerAuth()
@AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
@Controller({ path: 'geography', version: '1' })
export class GeographyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('governorates')
  @ApiOperation({ summary: 'All governorates' })
  governorates() {
    return this.prisma.governorate.findMany({
      orderBy: { nameEn: 'asc' },
      select: { id: true, code: true, nameAr: true, nameEn: true },
    });
  }

  @Get('cities')
  @ApiOperation({ summary: 'Cities, optionally filtered by governorate' })
  cities(@Query('governorateId') governorateId?: string) {
    return this.prisma.city.findMany({
      where: governorateId ? { governorateId } : {},
      orderBy: { nameEn: 'asc' },
      select: {
        id: true,
        code: true,
        nameAr: true,
        nameEn: true,
        governorateId: true,
      },
    });
  }

  @Get('districts')
  @ApiOperation({ summary: 'Districts, optionally filtered by city' })
  districts(@Query('cityId') cityId?: string) {
    return this.prisma.district.findMany({
      where: cityId ? { cityId } : {},
      orderBy: { nameEn: 'asc' },
      select: {
        id: true,
        code: true,
        nameAr: true,
        nameEn: true,
        cityId: true,
      },
    });
  }

  @Get('areas')
  @ApiOperation({ summary: 'Areas, optionally filtered by district' })
  areas(@Query('districtId') districtId?: string) {
    return this.prisma.area.findMany({
      where: districtId ? { districtId } : {},
      orderBy: { nameEn: 'asc' },
      select: {
        id: true,
        code: true,
        nameAr: true,
        nameEn: true,
        districtId: true,
      },
    });
  }

  /**
   * The whole tree in one call.
   *
   * The coverage editor and the case form both need every level at once; four
   * round trips to build one cascading select is three too many, and the
   * catalogue is small enough to send whole.
   */
  @Get('tree')
  @ApiOperation({ summary: 'The full hierarchy in one response' })
  async tree() {
    return this.prisma.governorate.findMany({
      orderBy: { nameEn: 'asc' },
      select: {
        id: true,
        code: true,
        nameAr: true,
        nameEn: true,
        cities: {
          orderBy: { nameEn: 'asc' },
          select: {
            id: true,
            code: true,
            nameAr: true,
            nameEn: true,
            districts: {
              orderBy: { nameEn: 'asc' },
              select: {
                id: true,
                code: true,
                nameAr: true,
                nameEn: true,
                areas: {
                  orderBy: { nameEn: 'asc' },
                  select: { id: true, code: true, nameAr: true, nameEn: true },
                },
              },
            },
          },
        },
      },
    });
  }

  @Get('governorates/:id')
  @ApiOperation({ summary: 'One governorate with its cities' })
  governorate(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.governorate.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        nameAr: true,
        nameEn: true,
        cities: {
          orderBy: { nameEn: 'asc' },
          select: { id: true, code: true, nameAr: true, nameEn: true },
        },
      },
    });
  }
}
