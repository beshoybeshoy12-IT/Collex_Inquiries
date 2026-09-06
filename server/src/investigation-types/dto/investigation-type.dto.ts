import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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

export class CreateInvestigationTypeDto {
  @ApiProperty({ example: 'RESIDENCE' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'الكود يجب أن يحتوي على حروف إنجليزية كبيرة وأرقام وشرطة سفلية فقط - ' +
      'Code must be uppercase letters, digits and underscores only',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  code: string;

  @ApiProperty({ example: 'استعلام سكن' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameAr: string;

  @ApiProperty({ example: 'Residence Verification' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameEn: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: '#2563eb' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colorHex must be #rrggbb' })
  colorHex?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  icon?: string;

  @ApiPropertyOptional({ default: 48 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  defaultSlaHours?: number;

  @ApiPropertyOptional({ description: 'The field form this type collects.' })
  @IsOptional()
  @IsUUID()
  formTemplateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reportTemplateId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Media category codes every case of this type must carry.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  requiredPhotoCategories?: string[];
}

export class UpdateInvestigationTypeDto extends PartialType(
  CreateInvestigationTypeDto,
) {}
