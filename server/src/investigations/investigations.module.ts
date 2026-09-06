import { Module } from '@nestjs/common';
import { InvestigationsController } from './investigations.controller';
import { InvestigationsService } from './investigations.service';
import { CaseNumberService } from './case-number.service';
import { SlaPolicyService } from './sla-policy.service';

/**
 * `CaseNumberService` and `SlaPolicyService` are exported because the import
 * pipeline and the assignment engine both need them — an import allocates
 * thousands of case numbers in one transaction, and reassignment recomputes a
 * due date. Two copies of either would be two ways for a case number to
 * collide.
 */
@Module({
  controllers: [InvestigationsController],
  providers: [InvestigationsService, CaseNumberService, SlaPolicyService],
  exports: [InvestigationsService, CaseNumberService, SlaPolicyService],
})
export class InvestigationsModule {}
