import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  InvestigationResult,
  InvestigationStatus,
  Priority,
} from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { StatusGroup, STATUS_GROUPS } from '../case-status.machine';

/** Optional-string helper: trims and turns an empty string into undefined. */
const TrimOrUndefined = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

/** Customer fields accepted when a case is created by hand. */
export class InlineCustomerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fullName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @TrimOrUndefined()
  nationalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @TrimOrUndefined()
  mobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @TrimOrUndefined()
  altMobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @TrimOrUndefined()
  homePhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @TrimOrUndefined()
  residenceAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @TrimOrUndefined()
  workplaceName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @TrimOrUndefined()
  workplacePhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @TrimOrUndefined()
  workplaceAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  governorateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  areaId?: string;
}

export class CreateInvestigationDto {
  @ApiPropertyOptional({ description: 'The client’s own reference.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @TrimOrUndefined()
  applicationNumber?: string;

  @ApiPropertyOptional({
    description:
      'Existing customer. Supply this OR `customer` to create one inline.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    type: () => InlineCustomerDto,
    description: 'Create the customer alongside the case (manual entry).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InlineCustomerDto)
  customer?: InlineCustomerDto;

  @ApiPropertyOptional({
    description: 'The bank or company this inquiry is for.',
  })
  @IsOptional()
  @IsUUID()
  clientAccountId?: string;

  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty()
  @IsUUID()
  investigationTypeId: string;

  @ApiPropertyOptional({ enum: Priority, default: Priority.NORMAL })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ description: 'Overrides the SLA-derived due date.' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional({ description: 'The address to visit for this case.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @TrimOrUndefined()
  addressLine?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  governorateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  areaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @TrimOrUndefined()
  notes?: string;
}

/**
 * `status` is absent from the update DTO on purpose.
 *
 * Status only moves through `POST /:id/transition`, which runs the state
 * machine. Allowing it here would let a PATCH put a case straight from NEW to
 * COMPLETED, and `forbidNonWhitelisted` turns an attempt to try into a 400
 * rather than a silent no-op.
 */
export class UpdateInvestigationDto extends PartialType(
  CreateInvestigationDto,
) {}

export class TransitionInvestigationDto {
  @ApiProperty({ enum: InvestigationStatus })
  @IsEnum(InvestigationStatus)
  status: InvestigationStatus;

  @ApiPropertyOptional({
    description: 'Required for transitions the machine marks as needing one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @TrimOrUndefined()
  reason?: string;

  @ApiPropertyOptional({ enum: InvestigationResult })
  @IsOptional()
  @IsEnum(InvestigationResult)
  result?: InvestigationResult;

  @ApiPropertyOptional({
    description:
      'Move outside the state machine. Needs investigations.override_status ' +
      'and a reason of at least 5 characters.',
  })
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

export class InvestigationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InvestigationStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : String(value).split(','),
  )
  @IsArray()
  @ArrayMaxSize(20)
  @IsEnum(InvestigationStatus, { each: true })
  status?: InvestigationStatus[];

  @ApiPropertyOptional({
    enum: Object.keys(STATUS_GROUPS),
    description:
      'A dashboard bucket — expands to its statuses. Cheaper for a client ' +
      'than listing them and keeps the two definitions from drifting.',
  })
  @IsOptional()
  @IsIn(Object.keys(STATUS_GROUPS))
  statusGroup?: StatusGroup;

  @ApiPropertyOptional({ enum: Priority, isArray: true })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : String(value).split(','),
  )
  @IsArray()
  @ArrayMaxSize(6)
  @IsEnum(Priority, { each: true })
  priority?: Priority[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  investigationTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  governorateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  investigatorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  coordinatorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  importBatchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientAccountId?: string;

  @ApiPropertyOptional({ description: 'Unassigned cases only.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unassigned?: boolean;

  @ApiPropertyOptional({ description: 'Past their due date and still open.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;

  @ApiPropertyOptional({ description: 'Cases that have been through rework.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  reworked?: boolean;

  @ApiPropertyOptional({ description: 'Created on or after this ISO date.' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Created on or before this ISO date.' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({ description: 'Due on or before this ISO date.' })
  @IsOptional()
  @IsDateString()
  dueBefore?: string;
}

export class BulkArchiveDto {
  @ApiProperty({ type: [String], maxItems: 500 })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  investigationIds: string[];
}

export class AddCommentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  body: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Internal notes are hidden from the field investigator.',
  })
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}

export class CaseNumberPreviewDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  count?: number;
}
