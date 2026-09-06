import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

/**
 * Global: virtually every mutation in the system records one of these, and
 * threading an import of this module through forty feature modules would only
 * mean that the one somebody forgot silently stops being audited.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
