import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { InvestigationTypesService } from './investigation-types.service';
import {
  CreateInvestigationTypeDto,
  UpdateInvestigationTypeDto,
} from './dto/investigation-type.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import {
  RequirePermission,
  TenantId,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

class TypeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  activeOnly?: boolean;
}

@ApiTags('investigation-types')
@ApiBearerAuth()
@Controller({ path: 'investigation-types', version: '1' })
export class InvestigationTypesController {
  constructor(private readonly types: InvestigationTypesService) {}

  @Get()
  @RequirePermission(P.INVESTIGATION_TYPES_VIEW)
  @ApiOperation({ summary: 'List investigation types' })
  findAll(@TenantId() tenantId: string, @Query() query: TypeQueryDto) {
    return this.types.findAll(tenantId, query);
  }

  @Get(':id')
  @RequirePermission(P.INVESTIGATION_TYPES_VIEW)
  @ApiOperation({ summary: 'One investigation type' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.types.findOne(tenantId, id);
  }

  @Post()
  @RequirePermission(P.INVESTIGATION_TYPES_MANAGE)
  @ApiOperation({ summary: 'Create an investigation type' })
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateInvestigationTypeDto,
  ) {
    return this.types.create(tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission(P.INVESTIGATION_TYPES_MANAGE)
  @ApiOperation({ summary: 'Edit an investigation type' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvestigationTypeDto,
  ) {
    return this.types.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.INVESTIGATION_TYPES_MANAGE)
  @ApiOperation({
    summary: 'Delete a type, or deactivate it if it has been used',
  })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.types.remove(tenantId, id);
  }
}
