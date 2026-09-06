import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { InvestigatorAvailability, InvestigatorStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateInvestigatorDto {
  @ApiProperty({ example: 'INV-0142' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  employeeCode: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName: string;

  @ApiProperty({ description: 'Also usable as the mobile sign-in identifier.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  nationalId?: string;

  @ApiPropertyOptional({ enum: ['ar', 'en'], default: 'ar' })
  @IsOptional()
  @IsIn(['ar', 'en'])
  locale?: string;

  @ApiPropertyOptional({ enum: InvestigatorStatus })
  @IsOptional()
  @IsEnum(InvestigatorStatus)
  status?: InvestigatorStatus;

  @ApiPropertyOptional({
    type: [String],
    description: 'Governorates covered. Empty means no restriction.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUUID('4', { each: true })
  governorateIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  cityIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @IsUUID('4', { each: true })
  districtIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @IsUUID('4', { each: true })
  areaIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Investigation types this person is qualified for.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  investigationTypeIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  productIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ default: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  maxDailyCases?: number;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  maxOpenCases?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  trainingCompletedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  contractEndsAt?: string;
}

export class UpdateInvestigatorDto extends PartialType(CreateInvestigatorDto) {}

export class InvestigatorQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InvestigatorStatus })
  @IsOptional()
  @IsEnum(InvestigatorStatus)
  status?: InvestigatorStatus;

  @ApiPropertyOptional({ enum: InvestigatorAvailability })
  @IsOptional()
  @IsEnum(InvestigatorAvailability)
  availability?: InvestigatorAvailability;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  governorateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  investigationTypeId?: string;
}

export class SetInvestigatorStatusDto {
  @ApiProperty({ enum: InvestigatorStatus })
  @IsEnum(InvestigatorStatus)
  status: InvestigatorStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateAvailabilityDto {
  @ApiProperty({ enum: InvestigatorAvailability })
  @IsEnum(InvestigatorAvailability)
  availability: InvestigatorAvailability;
}

/**
 * A position report from the handset. There is no `investigatorId` — the id
 * comes from the authenticated principal, so one investigator cannot report a
 * position on behalf of another.
 */
export class UpdateLocationDto {
  @ApiProperty()
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @ApiProperty()
  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @ApiPropertyOptional({ description: 'Reported accuracy in metres.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  accuracyM?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  speedMps?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  headingDeg?: number;

  @ApiPropertyOptional({ description: 'The case this fix relates to, if any.' })
  @IsOptional()
  @IsUUID()
  investigationId?: string;

  @ApiPropertyOptional({
    description:
      'When the device recorded it. Kept separate from the server timestamp ' +
      'so an offline queue can report a fix taken twenty minutes earlier.',
  })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;

  @ApiPropertyOptional({ enum: InvestigatorAvailability })
  @IsOptional()
  @IsEnum(InvestigatorAvailability)
  availability?: InvestigatorAvailability;
}
