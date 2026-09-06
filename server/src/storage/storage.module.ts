import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Global: imports, media, reports and exports all store objects, and a second
 * instance would mean a second driver and a second set of credentials.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
