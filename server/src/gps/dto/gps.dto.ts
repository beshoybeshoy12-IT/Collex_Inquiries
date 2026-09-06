import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { GpsEventType } from '@prisma/client';

/**
 * No `investigatorId`. The reporter is the authenticated principal, so a
 * request cannot claim a fix on somebody else's behalf.
 */
export class RecordGpsEventDto {
  @ApiProperty({ enum: GpsEventType })
  @IsEnum(GpsEventType)
  eventType: GpsEventType;

  @ApiProperty()
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @ApiProperty()
  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @ApiPropertyOptional({ description: 'Reported accuracy, in metres.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  accuracyM?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  altitudeM?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  speedMps?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  headingDeg?: number;

  @ApiPropertyOptional({ description: 'The case this fix belongs to.' })
  @IsOptional()
  @IsUUID()
  investigationId?: string;

  @ApiPropertyOptional({
    description:
      'When the device recorded it. Defaults to now. Kept separate from the ' +
      'server timestamp so an offline queue can report an older fix honestly.',
  })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
