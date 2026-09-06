import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import { ProductsService } from './products.service';
import {
  CreateProductDto,
  SetProductTypesDto,
  UpdateProductDto,
} from './dto/product.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import {
  RequirePermission,
  TenantId,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

class ProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Hide deactivated products.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  activeOnly?: boolean;
}

@ApiTags('products')
@ApiBearerAuth()
@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermission(P.PRODUCTS_VIEW)
  @ApiOperation({ summary: 'List products' })
  findAll(@TenantId() tenantId: string, @Query() query: ProductQueryDto) {
    return this.products.findAll(tenantId, query);
  }

  @Get(':id')
  @RequirePermission(P.PRODUCTS_VIEW)
  @ApiOperation({
    summary: 'One product, with its enabled investigation types',
  })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.products.findOne(tenantId, id);
  }

  @Post()
  @RequirePermission(P.PRODUCTS_MANAGE)
  @ApiOperation({ summary: 'Create a product' })
  create(@TenantId() tenantId: string, @Body() dto: CreateProductDto) {
    return this.products.create(tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission(P.PRODUCTS_MANAGE)
  @ApiOperation({ summary: 'Edit a product' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(tenantId, id, dto);
  }

  @Put(':id/investigation-types')
  @RequirePermission(P.PRODUCTS_MANAGE)
  @ApiOperation({
    summary: 'Set which investigation types this product allows',
  })
  setTypes(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetProductTypesDto,
  ) {
    return this.products.setInvestigationTypes(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.PRODUCTS_MANAGE)
  @ApiOperation({
    summary: 'Delete a product, or deactivate it if it has been used',
  })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.remove(tenantId, id);
  }
}
