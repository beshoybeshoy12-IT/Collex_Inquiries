import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_IDLE_MINUTES, MIN_IDLE_MINUTES } from '../attendance.util';

export class UpdateAttendanceSettingsDto {
  @ApiProperty({
    minimum: MIN_IDLE_MINUTES,
    maximum: MAX_IDLE_MINUTES,
    description: 'Minutes without activity after which time counts as idle.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_IDLE_MINUTES)
  @Max(MAX_IDLE_MINUTES)
  idleMinutes: number;
}
