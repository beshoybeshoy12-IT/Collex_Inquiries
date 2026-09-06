import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

/**
 * Exported because the import pipeline reuses `findPotentialDuplicates` — the
 * duplicate rules a coordinator sees on the manual-entry form and the ones the
 * import preview applies have to be the same rules, or the two screens will
 * disagree about what a duplicate is.
 */
@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
