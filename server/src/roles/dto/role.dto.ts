import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'SENIOR_COORDINATOR' })
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
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    minimum: 0,
    maximum: 99,
    description:
      'Who may act on whom. Higher outranks lower; a user can only act on ' +
      'someone strictly below them. Capped below the seeded admin rank of 100 ' +
      'so a custom role can never outrank the company administrator.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  rank: number;

  @ApiProperty({ type: [String], example: ['investigations.view'] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  permissions: string[];
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}
