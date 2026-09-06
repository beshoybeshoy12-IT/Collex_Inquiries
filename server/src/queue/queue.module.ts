import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';

/** Global: reports, exports and the maintenance sweeps all dispatch jobs. */
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
