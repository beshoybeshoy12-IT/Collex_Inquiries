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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import {
  CreateCustomerDto,
  CustomerQueryDto,
  DuplicateCheckDto,
  MergeCustomersDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
import {
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

@ApiTags('customers')
@ApiBearerAuth()
@Controller({ path: 'customers', version: '1' })
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission(P.CUSTOMERS_VIEW)
  @ApiOperation({ summary: 'Search customers' })
  findAll(@TenantId() tenantId: string, @Query() query: CustomerQueryDto) {
    return this.customers.findAll(tenantId, query);
  }

  /**
   * Called by the manual-entry form before it saves, so the user is warned
   * about a duplicate while they can still do something about it rather than
   * after a 409.
   */
  @Post('check-duplicates')
  @RequirePermission(P.CUSTOMERS_VIEW)
  @ApiOperation({ summary: 'Possible duplicates for a candidate customer' })
  checkDuplicates(
    @TenantId() tenantId: string,
    @Body() dto: DuplicateCheckDto,
  ) {
    return this.customers.findPotentialDuplicates(tenantId, dto);
  }

  @Get(':id')
  @RequirePermission(P.CUSTOMERS_VIEW)
  @ApiOperation({ summary: 'Customer 360 — profile plus full case history' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.findOne(tenantId, id);
  }

  @Post()
  @RequirePermission(P.CUSTOMERS_CREATE)
  @ApiOperation({ summary: 'Create a customer' })
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.customers.create(tenantId, user, dto);
  }

  @Patch(':id')
  @RequirePermission(P.CUSTOMERS_EDIT)
  @ApiOperation({ summary: 'Edit a customer' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(tenantId, id, dto);
  }

  @Post('merge')
  @RequirePermission(P.CUSTOMERS_MERGE)
  @ApiOperation({ summary: 'Fold a duplicate into the record that survives' })
  merge(@TenantId() tenantId: string, @Body() dto: MergeCustomersDto) {
    return this.customers.merge(tenantId, dto);
  }

  @Delete(':id')
  @RequirePermission(P.CUSTOMERS_DELETE)
  @ApiOperation({ summary: 'Soft-delete a customer with no cases' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.remove(tenantId, id);
  }
}
