import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_TEMPLATE_FIELDS } from '../clients.util';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Empty strings from a form mean "not set". */
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class TemplateFieldDto {
  @ApiPropertyOptional({ description: 'Stable id; generated when missing.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  key?: string;

  @ApiProperty({ example: 'رقم الطلب' })
  @IsString()
  @MaxLength(80)
  header: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'An import field key, or null for a field only this client has.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(40)
  target?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export class CreateClientDto {
  @ApiProperty({ example: 'بنك مصر' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameAr: string;

  @ApiProperty({ example: 'Banque Misr' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameEn: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, value) => value !== null)
  @IsEmail()
  @MaxLength(160)
  contactEmail?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(40)
  contactPhone?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Products this client may have. Empty means all.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  productIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Inquiry types this client may have. Empty means all.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  investigationTypeIds?: string[];

  @ApiPropertyOptional({ type: [TemplateFieldDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TEMPLATE_FIELDS)
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldDto)
  templateFields?: TemplateFieldDto[];
}

export class UpdateClientDto extends PartialType(CreateClientDto) {
  @ApiPropertyOptional({ description: 'False archives the client.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
