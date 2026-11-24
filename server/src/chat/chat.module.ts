import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/**
 * Internal chat. Prisma, storage, the audit log and the realtime gateway are
 * global, so nothing is imported here.
 */
@Module({
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
