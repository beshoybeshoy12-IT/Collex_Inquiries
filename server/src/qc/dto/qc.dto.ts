import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { InvestigationStatus, QcDecision } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class QcQueueQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: InvestigationStatus,
    description: 'Defaults to QC_PENDING — the actual queue.',
  })
  @IsOptional()
  @IsEnum(InvestigationStatus)
  status?: InvestigationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  investigationTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  investigatorId?: string;
}

export class QcDecisionDto {
  @ApiProperty({ enum: QcDecision })
  @IsEnum(QcDecision)
  decision: QcDecision;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Configured rejection reasons. Required for anything but an approval, ' +
      'unless a free-text comment is given.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  reasonIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  comment?: string;

  @ApiPropertyOptional({
    description: 'Per-field remarks keyed by form field key.',
    example: { residencePhoto: 'Front door is not visible' },
  })
  @IsOptional()
  @IsObject()
  fieldRemarks?: Record<string, string>;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;
}

export class UpsertRejectionReasonDto {
  @ApiProperty({ example: 'MISSING_PHOTO' })
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
  @MaxLength(160)
  nameAr: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  nameEn: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Force a free-text explanation when this reason is chosen.',
  })
  @IsOptional()
  @IsBoolean()
  needsNote?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
