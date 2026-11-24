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
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ImportBatchStatus, ImportRowStatus, Priority } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class InspectImportDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sheetName?: string;

  @ApiPropertyOptional({
    default: 1,
    description: 'Which row holds the headers.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  headerRow?: number;
}

/**
 * `mapping` is `{ systemFieldKey: sourceColumnHeader }` — that direction, not
 * the reverse, because a system field maps to exactly one column while a
 * spreadsheet can carry columns that map to nothing.
 */
export class PrepareImportDto extends InspectImportDto {
  @ApiPropertyOptional({
    description: 'Column mapping. Supply this or `mappingTemplateId`.',
    example: { fullName: 'Customer Name', mobile: 'Mobile' },
  })
  @IsOptional()
  @IsObject()
  @Transform(({ value }) =>
    typeof value === 'string' ? JSON.parse(value) : value,
  )
  mapping?: Record<string, string>;

  @ApiPropertyOptional({ description: 'A saved mapping template to apply.' })
  @IsOptional()
  @IsUUID()
  mappingTemplateId?: string;

  @ApiPropertyOptional({
    description:
      'The client (bank/company) this file is from. Its template supplies the ' +
      'mapping when none is sent, and every case created belongs to it.',
  })
  @IsOptional()
  @IsUUID()
  clientAccountId?: string;

  @ApiPropertyOptional({ description: 'Used for rows with no product column.' })
  @IsOptional()
  @IsUUID()
  defaultProductId?: string;

  @ApiPropertyOptional({ description: 'Used for rows with no type column.' })
  @IsOptional()
  @IsUUID()
  defaultInvestigationTypeId?: string;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  defaultPriority?: Priority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  defaultDueAt?: string;
}

export class ConfirmImportDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Import rows flagged as duplicates as well. Off by default so a ' +
      'confirmation cannot silently double-create work.',
  })
  @IsOptional()
  @IsBoolean()
  includeDuplicates?: boolean;
}

export class DuplicateResolutionDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rowNumber: number;

  @ApiProperty({ enum: ['CREATE_ANYWAY', 'SKIP'] })
  @IsIn(['CREATE_ANYWAY', 'SKIP'])
  action: 'CREATE_ANYWAY' | 'SKIP';
}

export class ResolveDuplicatesDto {
  @ApiProperty({ type: [DuplicateResolutionDto] })
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => DuplicateResolutionDto)
  resolutions: DuplicateResolutionDto[];
}

export class ImportBatchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ImportBatchStatus })
  @IsOptional()
  @IsEnum(ImportBatchStatus)
  status?: ImportBatchStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientAccountId?: string;
}

export class ImportRowQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ImportRowStatus })
  @IsOptional()
  @IsEnum(ImportRowStatus)
  status?: ImportRowStatus;
}

export class CreateMappingTemplateDto {
  @ApiProperty({ example: 'CIB_MONTHLY' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'Code must be uppercase letters, digits and underscores only',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  code: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameAr: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameEn: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: { fullName: 'Customer Name', mobile: 'Mobile' } })
  @IsObject()
  mapping: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  defaults?: Record<string, unknown>;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateMappingTemplateDto extends PartialType(
  CreateMappingTemplateDto,
) {}

export class FixCellDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rowNumber: number;

  @ApiProperty({ description: 'The column header, as in the file.' })
  @IsString()
  @MaxLength(200)
  column: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  value: string;
}

export class FixReplaceDto {
  @ApiProperty({ description: 'The column header, as in the file.' })
  @IsString()
  @MaxLength(200)
  column: string;

  @ApiProperty({
    description: 'The cell text to find (trimmed, case-insensitive).',
  })
  @IsString()
  @MaxLength(1000)
  from: string;

  @ApiProperty({ description: 'What to put instead — e.g. a product code.' })
  @IsString()
  @MaxLength(1000)
  to: string;
}

/** Corrections to a staged batch, applied before it is confirmed. */
export class FixImportDto {
  @ApiPropertyOptional({ type: [FixCellDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => FixCellDto)
  cells?: FixCellDto[];

  @ApiPropertyOptional({ type: [FixReplaceDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FixReplaceDto)
  replace?: FixReplaceDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Empty string clears it.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== '' && value !== null)
  @IsUUID()
  defaultProductId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Empty string clears it.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== '' && value !== null)
  @IsUUID()
  defaultInvestigationTypeId?: string | null;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Rows to leave out of this import (kept as SKIPPED).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  skipRows?: number[];

  @ApiPropertyOptional({ description: 'Leave out every row that has errors.' })
  @IsOptional()
  @IsBoolean()
  skipInvalid?: boolean;
}
