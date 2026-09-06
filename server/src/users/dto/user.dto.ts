import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { UserStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * There is no `password` field, and there never will be. `create` generates
 * one and returns it once; `resetPassword` generates a new one. An
 * administrator who can set a password can set a memorable one, and a
 * memorable one set by somebody else is the credential that ends up on a
 * sticky note.
 *
 * `isSuperAdmin` is absent for the same reason as `tenantId`: it is not
 * something an API caller gets to decide.
 */
export class CreateUserDto {
  @ApiProperty()
  @IsEmail(
    {},
    { message: 'البريد الإلكتروني غير صالح - Invalid email address' },
  )
  @MaxLength(200)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fullName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  employeeCode?: string;

  @ApiPropertyOptional({ enum: ['ar', 'en'], default: 'ar' })
  @IsOptional()
  @IsIn(['ar', 'en'])
  locale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  branch?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;

  @ApiPropertyOptional({ description: 'The role this user is assigned.' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Governorates this user may see cases in. Empty means the whole company.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUUID('4', { each: true })
  allowedGovernorateIds?: string[];
}

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, [] as const),
) {}

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;
}

export class SetUserStatusDto {
  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  status: UserStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PermissionOverrideDto {
  @ApiProperty({ example: 'investigations.assign' })
  @IsString()
  @MaxLength(80)
  permissionCode: string;

  @ApiProperty({ description: 'false is an explicit deny and beats the role.' })
  @IsBoolean()
  granted: boolean;
}

export class SetUserPermissionsDto {
  @ApiProperty({ type: [PermissionOverrideDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PermissionOverrideDto)
  overrides: PermissionOverrideDto[];
}
