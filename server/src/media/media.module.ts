import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [
    MulterModule.register({
      limits: { fileSize: 30 * 1024 * 1024, files: 1 },
    }),
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
