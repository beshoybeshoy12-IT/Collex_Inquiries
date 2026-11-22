import { Global, Module } from '@nestjs/common';
import { PushService } from './push.service';

/**
 * Global, like `StorageModule` and `NotificationsModule`.
 *
 * `NotificationsService` delivers through this, and the sign-out path disables
 * tokens through it. A second instance would mean a second driver and, once a
 * real provider is configured, a second set of credentials.
 */
@Global()
@Module({
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
