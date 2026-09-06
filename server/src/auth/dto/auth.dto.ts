import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Note what is absent from every DTO in this codebase: `tenantId`.
 *
 * The tenant is derived from the verified token, never from a request body.
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so a client that tries to
 * send one gets a 400 rather than being quietly ignored — which means the rule
 * is enforced by the framework, not by reviewers remembering it.
 *
 * `tenantCode` on login is the one exception and is not the same thing: it
 * disambiguates *which* login to attempt, before anybody is authenticated, and
 * it is matched against the credentials rather than trusted on its own.
 */

export class LoginDto {
  @ApiProperty({ example: 'coordinator@demo.local' })
  @IsEmail(
    {},
    { message: 'البريد الإلكتروني غير صالح - Invalid email address' },
  )
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiProperty({ example: 'S3cure-Passphrase' })
  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة - Password is required' })
  @MaxLength(200)
  password: string;

  @ApiPropertyOptional({
    description:
      'Required only when the same email exists in more than one company. ' +
      'The API answers 409 with the list of company codes when it is needed.',
    example: 'DEMO',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  tenantCode?: string;

  @ApiPropertyOptional({
    description: 'Free-text device label for the session list.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  device?: string;
}

export class InvestigatorLoginDto {
  @ApiProperty({
    description: 'Employee code or phone number.',
    example: 'INV-0142',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  identifier: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;

  @ApiProperty({ example: 'DEMO', description: 'Company code.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  tenantCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceModel?: string;

  @ApiPropertyOptional({ example: 'android' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  devicePlatform?: string;

  @ApiPropertyOptional({
    description: 'FCM/APNs token for push notifications.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  pushToken?: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  currentPassword: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  newPassword: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  tenantCode?: string;
}
