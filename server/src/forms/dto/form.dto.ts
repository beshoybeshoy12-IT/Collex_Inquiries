import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
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
import { InvestigationResult } from '@prisma/client';

export class CreateFormTemplateDto {
  @ApiProperty({ example: 'RESIDENCE_V1' })
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

  @ApiPropertyOptional({
    description: 'Initial schema for the draft v1. Defaults to empty.',
  })
  @IsOptional()
  @IsObject()
  schema?: Record<string, unknown>;
}

export class UpdateFormTemplateDto extends PartialType(CreateFormTemplateDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SaveFormVersionDto {
  @ApiProperty({
    description:
      'The full field tree. Validated on save and again on publish; see ' +
      'form-schema.ts for the shape.',
  })
  @IsObject()
  schema: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'What changed, for the version list.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}

export class CreateDraftDto {
  @ApiPropertyOptional({
    description: 'Copy from this version. Defaults to the published one.',
  })
  @IsOptional()
  @IsUUID()
  fromVersionId?: string;
}

export class SaveSubmissionDto {
  @ApiProperty({ description: 'Answers keyed by field key.' })
  @IsObject()
  answers: Record<string, unknown>;
}

export class SubmitFormDto extends SaveSubmissionDto {
  @ApiPropertyOptional({
    enum: InvestigationResult,
    description: 'The investigator’s verdict, independent of the QC outcome.',
  })
  @IsOptional()
  @IsEnum(InvestigationResult)
  result?: InvestigationResult;

  @ApiPropertyOptional({
    description:
      'A client-generated id that makes a retry idempotent. The offline ' +
      'queue on the mobile client sets this.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientSubmissionId?: string;
}

export class ChooseFormDto {
  @ApiProperty({ description: 'The form template the case is answered on.' })
  @IsUUID()
  formTemplateId: string;

  @ApiPropertyOptional({
    description:
      'Confirms that answers already entered on the current form may be discarded.',
  })
  @IsOptional()
  @IsBoolean()
  discardDraft?: boolean;
}

export class OfficeSubmitDto {
  @ApiPropertyOptional({
    description:
      'Answers keyed by field key. Omit to hand in the draft already saved.',
  })
  @IsOptional()
  @IsObject()
  answers?: Record<string, unknown>;

  @ApiPropertyOptional({
    enum: InvestigationResult,
    description: 'The outcome the investigator wrote on the paper form.',
  })
  @IsOptional()
  @IsEnum(InvestigationResult)
  result?: InvestigationResult;
}
