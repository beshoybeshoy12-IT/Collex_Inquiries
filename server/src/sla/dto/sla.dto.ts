import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EscalationTrigger, Priority } from '@prisma/client';

export class UpsertSlaPolicyDto {
  @ApiProperty({ example: 'STANDARD_48H' })
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

  @ApiPropertyOptional({
    description:
      'Scope. A policy naming both a product and a type beats one naming ' +
      'only the product, which beats the tenant default.',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  investigationTypeId?: string;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiProperty({ description: 'Whole-case budget, in hours.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  totalHours: number;

  @ApiProperty({ default: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  assignmentHours: number;

  @ApiProperty({ default: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  acceptanceHours: number;

  @ApiProperty({ default: 24 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fieldHours: number;

  @ApiProperty({ default: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  qcHours: number;

  @ApiPropertyOptional({
    default: 80,
    description: 'Percentage of the budget at which the case turns YELLOW.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  warnAtPercent?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Stop the clock outside working hours.',
  })
  @IsOptional()
  @IsBoolean()
  businessHoursOnly?: boolean;

  @ApiProperty({ default: 9 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  workdayStartHour: number;

  @ApiProperty({ default: 17 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  workdayEndHour: number;

  @ApiPropertyOptional({
    type: [Number],
    default: [7, 1, 2, 3, 4],
    description: 'ISO weekday numbers, 1 = Monday … 7 = Sunday.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workdays?: number[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpsertEscalationRuleDto {
  @ApiProperty({ example: 'NOT_ACCEPTED_2H' })
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

  @ApiProperty({ enum: EscalationTrigger })
  @IsEnum(EscalationTrigger)
  trigger: EscalationTrigger;

  @ApiProperty({
    description: 'Minutes after the triggering moment before this rule fires.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  thresholdMinutes: number;

  @ApiPropertyOptional({
    description: 'Fire again every N minutes. Omit for a one-shot rule.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  repeatEveryMinutes?: number;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Role codes to notify. Roles rather than user ids, so the rule ' +
      'survives the person who held the job leaving.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  notifyRoleCodes?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  notifyCoordinator?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  notifyInvestigator?: boolean;

  @ApiPropertyOptional({
    enum: Priority,
    description: 'Limit the rule to cases of one priority.',
  })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
