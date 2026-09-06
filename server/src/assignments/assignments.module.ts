import { Module } from '@nestjs/common';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { InvestigationsModule } from '../investigations/investigations.module';

/**
 * Imports `InvestigationsModule` for `SlaPolicyService`: the acceptance window
 * on an assignment offer comes from the same policy that sets the case's due
 * date, and resolving it twice from two places is how the offer expires at a
 * time the SLA does not agree with.
 */
@Module({
  imports: [InvestigationsModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
