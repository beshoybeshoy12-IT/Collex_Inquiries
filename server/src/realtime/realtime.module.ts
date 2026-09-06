import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Global because notifications, imports, exports and the case services all
 * emit. The gateway itself is only bound to a server in the API process; in
 * the worker it is constructed but never initialised, which its emit helpers
 * tolerate by design.
 */
@Global()
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
