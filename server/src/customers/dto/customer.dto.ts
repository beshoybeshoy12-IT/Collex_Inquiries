import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const Trim = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

export class CreateCustomerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fullName: string;

  @ApiPropertyOptional({
    description: '14 digits for an Egyptian national id.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Trim()
  nationalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Trim()
  mobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Trim()
  altMobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Trim()
  homePhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  @Trim()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Trim()
  residenceAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  governorateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  areaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Trim()
  workplaceName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Trim()
  workplacePhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Trim()
  workplaceAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Trim()
  jobTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Trim()
  notes?: string;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}

export class CustomerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  governorateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cityId?: string;
}

export class MergeCustomersDto {
  @ApiProperty({ description: 'The customer that survives the merge.' })
  @IsUUID()
  keepId: string;

  @ApiProperty({ description: 'The duplicate, folded in and soft-deleted.' })
  @IsUUID()
  mergeId: string;
}

export class DuplicateCheckDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Trim()
  nationalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Trim()
  mobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Trim()
  fullName?: string;
}
