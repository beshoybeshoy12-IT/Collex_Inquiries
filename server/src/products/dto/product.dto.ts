import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Priority } from '@prisma/client';

/**
 * `code` is constrained to A-Z, 0-9 and underscore because it is a business
 * identifier that appears in import mappings, exports and file names. Allowing
 * spaces or Arabic here would make it a display name, which is what `nameAr`
 * and `nameEn` are for.
 */
export class CreateProductDto {
  @ApiProperty({ example: 'CREDIT_CARD' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'كود المنتج يجب أن يحتوي على حروف إنجليزية كبيرة وأرقام وشرطة سفلية فقط - ' +
      'Product code must be uppercase letters, digits and underscores only',
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
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 48 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  defaultSlaHours?: number;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  defaultPriority?: Priority;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  requiredFields?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  requiredDocuments?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  requiredPhotos?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reportTemplateId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Investigation types to enable.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  investigationTypeIds?: string[];
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ProductTypePairingDto {
  @ApiProperty()
  @IsUUID()
  investigationTypeId: string;

  @ApiPropertyOptional({
    description: 'Overrides the type default for this product.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  slaHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;
}

export class SetProductTypesDto {
  @ApiProperty({ type: [ProductTypePairingDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProductTypePairingDto)
  investigationTypes: ProductTypePairingDto[];
}
