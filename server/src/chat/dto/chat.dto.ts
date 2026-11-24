import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PrincipalType } from '@prisma/client';
import {
  MAX_BODY_LENGTH,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
} from '../chat.util';

export class OpenConversationDto {
  @ApiProperty({ enum: PrincipalType })
  @IsEnum(PrincipalType)
  type: PrincipalType;

  @ApiProperty()
  @IsUUID()
  id: string;
}

export class SendMessageDto {
  @ApiPropertyOptional({ maxLength: MAX_BODY_LENGTH })
  @IsOptional()
  @IsString()
  // A little headroom: the service trims before measuring.
  @MaxLength(MAX_BODY_LENGTH + 200)
  body?: string;
}

export class MessagesQueryDto {
  @ApiPropertyOptional({ description: 'Messages before this time (ISO).' })
  @IsOptional()
  @IsDateString()
  before?: string;

  @ApiPropertyOptional({ default: 40, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ChatSettingsDto {
  @ApiProperty({ minimum: MIN_RETENTION_DAYS, maximum: MAX_RETENTION_DAYS })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_RETENTION_DAYS)
  @Max(MAX_RETENTION_DAYS)
  retentionDays: number;
}
