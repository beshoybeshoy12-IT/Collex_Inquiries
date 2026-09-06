import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AssignDto {
  @ApiProperty()
  @IsUUID()
  investigationId: string;

  @ApiProperty()
  @IsUUID()
  investigatorId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Assign past a capacity or coverage warning. Recorded on the audit row.',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class BulkAssignDto {
  @ApiProperty({ type: [String], maxItems: 500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  investigationIds: string[];

  @ApiProperty()
  @IsUUID()
  investigatorId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/**
 * A reason is required, not optional: reassignment is the transition an
 * investigator will ask about, and "why was this taken off me" has to have an
 * answer in the record rather than in somebody's memory.
 */
export class ReassignDto {
  @ApiProperty()
  @IsUUID()
  investigationId: string;

  @ApiProperty({ description: 'The new investigator.' })
  @IsUUID()
  investigatorId: string;

  @ApiProperty({ description: 'Why the case is moving. Required.' })
  @IsString()
  @IsNotEmpty({
    message: 'سبب إعادة الإسناد مطلوب - A reassignment reason is required',
  })
  @MaxLength(1000)
  reason: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class RespondToAssignmentDto {
  @ApiProperty({ description: 'true to accept, false to decline.' })
  @IsBoolean()
  accept: boolean;

  @ApiPropertyOptional({ description: 'Required when declining.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class SuggestQueryDto {
  @ApiProperty()
  @IsUUID()
  investigationId: string;

  @ApiPropertyOptional({ default: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
