import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ReportLocale } from '@prisma/client';

export class GenerateReportDto {
  @ApiPropertyOptional({
    enum: ReportLocale,
    default: ReportLocale.AR,
    description: 'Arabic, English, or both languages side by side.',
  })
  @IsOptional()
  @IsEnum(ReportLocale)
  locale?: ReportLocale;

  @ApiPropertyOptional({
    description: 'Overrides the type/product/default template resolution.',
  })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'A final report closes the case. Drafts do not, so a coordinator may ' +
      'generate several before choosing which to deliver.',
  })
  @IsOptional()
  @IsBoolean()
  isFinal?: boolean;
}

export class UpsertReportTemplateDto {
  @ApiProperty({ example: 'STANDARD_AR' })
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
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ description: 'Handlebars source for the document body.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200_000)
  bodyHtml: string;

  @ApiPropertyOptional({
    description: 'Running header, printed on every page.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  headerHtml?: string;

  @ApiPropertyOptional({
    description: 'Running footer, printed on every page.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  footerHtml?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  css?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  showLogo?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  showQrCode?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  showWatermark?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  watermarkText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  disclaimerAr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  disclaimerEn?: string;

  @ApiPropertyOptional({ default: 'A4' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  pageSize?: string;

  @ApiPropertyOptional({
    description: 'Page margins in millimetres.',
    example: { top: 18, right: 14, bottom: 18, left: 14 },
  })
  @IsOptional()
  @IsObject()
  marginsMm?: Record<string, number>;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
