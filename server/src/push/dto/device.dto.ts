import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PushPlatform } from '@prisma/client';

/**
 * What a handset sends to register itself.
 *
 * Note what is absent, and why `forbidNonWhitelisted` makes the absence
 * enforced rather than merely intended: there is no `tenantId`, no `userId` and
 * no `investigatorId`. A device registers itself for whoever is holding the
 * token that made the request, and "register this device for somebody else" is
 * a sentence this API cannot express.
 */
export class RegisterDeviceDto {
  @ApiProperty({
    description:
      'The FCM or APNs registration token. Rotates on the provider’s own ' +
      'schedule — call this route again whenever it does, not only at login.',
  })
  @IsString()
  @IsNotEmpty()
  // Providers do not publish a maximum. FCM tokens run ~160 chars today and
  // have grown twice; 512 is headroom without being a place to store a blob.
  @MaxLength(512)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  token: string;

  @ApiProperty({ enum: PushPlatform })
  @IsEnum(PushPlatform)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  platform: PushPlatform;

  @ApiPropertyOptional({ description: 'So a delivery bug can be traced to a build.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;

  @ApiPropertyOptional({ example: 'SM-A155F' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceModel?: string;

  @ApiPropertyOptional({ example: 'Android 14' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  osVersion?: string;

  @ApiPropertyOptional({
    enum: ['ar', 'en'],
    description:
      'Which half of the stored bilingual notification to put on the lock ' +
      'screen. Defaults to Arabic.',
  })
  @IsOptional()
  @IsIn(['ar', 'en'])
  locale?: string;
}
