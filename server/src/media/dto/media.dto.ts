import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { MediaType } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * There is no `storageKey` here, and there never will be. The key is derived by
 * the service from the tenant and a UUID; accepting one from a client would let
 * a caller write over another tenant's object or read one back by guessing.
 */
export class RequestUploadDto {
  @ApiProperty({ enum: MediaType })
  @IsEnum(MediaType)
  mediaType: MediaType;

  @ApiProperty({ example: 'residence-front.jpg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  contentType: string;

  @ApiProperty({ description: 'Bytes. Bound into the presigned signature.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes: number;

  @ApiPropertyOptional({ description: 'The case this evidence belongs to.' })
  @IsOptional()
  @IsUUID()
  investigationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    example: 'RESIDENCE_FRONT',
    description: 'A configured media category code.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  categoryCode?: string;

  @ApiPropertyOptional({ description: 'SHA-256 the client computed, if any.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  checksum?: string;

  @ApiPropertyOptional({
    description:
      'When the device captured it — distinct from when it was uploaded, ' +
      'which matters when an offline queue sends it hours later.',
  })
  @IsOptional()
  @IsDateString()
  capturedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  captureLat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  captureLng?: number;

  @ApiPropertyOptional({ description: 'Reported accuracy, in metres.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  captureAccuracy?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}

export class ConfirmUploadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  width?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  height?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationSec?: number;
}

export class MediaQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  investigationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ enum: MediaType })
  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoryCode?: string;
}

export class DeleteMediaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpsertMediaCategoryDto {
  @ApiProperty({ example: 'RESIDENCE_FRONT' })
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

  @ApiProperty({ example: 'واجهة السكن' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameAr: string;

  @ApiProperty({ example: 'Residence Front' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameEn: string;

  @ApiPropertyOptional({ enum: MediaType, default: MediaType.PHOTO })
  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCount?: number;

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
