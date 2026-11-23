import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * The signed-in user's own profile photo and cover. Storage, Prisma and the
 * audit log are global modules, so nothing is imported here.
 */
@Module({
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
