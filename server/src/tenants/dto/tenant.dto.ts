import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TenantStatus } from '@prisma/client';

/**
 * The tenant-facing DTO. Note what is NOT here: `status`, `maxWebUsers`,
 * `maxInvestigators` and `subscriptionEnd`. A company raising its own limits
 * or un-suspending itself is not a request this API can express, and
 * `forbidNonWhitelisted` turns an attempt into a 400 rather than a silent
 * no-op.
 */
export class UpdateTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameAr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @ApiPropertyOptional({ example: '#1d4ed8' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'primaryColor must be #rrggbb' })
  primaryColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  taxId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressLine?: string;
}

export class UpdateTenantSettingsDto {
  @ApiPropertyOptional({
    description:
      'Feature gates, keyed by permission category. A category set to false ' +
      'removes its permissions from every user, whatever their role says.',
    example: { qc: true, forms: true, clients: false },
  })
  @IsOptional()
  @IsObject()
  featureFlags?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Free-form operational preferences.' })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['ar', 'en'] })
  @IsOptional()
  @IsIn(['ar', 'en'])
  defaultLocale?: string;

  @ApiPropertyOptional({ example: 'Africa/Cairo' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;
}

/** Platform operator only. Provisions the company and its first administrator. */
export class CreateTenantDto {
  @ApiProperty({ example: 'ACME' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
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

  @ApiProperty({ description: 'Email for the first administrator account.' })
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  adminEmail: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  adminName: string;

  @ApiPropertyOptional({ enum: TenantStatus, default: TenantStatus.TRIAL })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  taxId?: string;

  @ApiPropertyOptional({ enum: ['ar', 'en'], default: 'ar' })
  @IsOptional()
  @IsIn(['ar', 'en'])
  defaultLocale?: string;

  @ApiPropertyOptional({ default: 'Africa/Cairo' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  maxWebUsers?: number;

  @ApiPropertyOptional({ default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50_000)
  maxInvestigators?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  subscriptionEnd?: string;
}

export class SetTenantStatusDto {
  @ApiProperty({ enum: TenantStatus })
  @IsEnum(TenantStatus)
  status: TenantStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SetTenantLimitsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  maxWebUsers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50_000)
  maxInvestigators?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  subscriptionEnd?: string;
}
