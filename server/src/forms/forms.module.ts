import { Module } from '@nestjs/common';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';
import { SubmissionsService } from './submissions.service';
import { InvestigationsModule } from '../investigations/investigations.module';

/**
 * Imports `InvestigationsModule` because submitting a form moves the case, and
 * moving a case has to go through the one state machine. A second copy of the
 * transition logic here is exactly how a case ends up SUBMITTED with no history
 * row behind it.
 */
@Module({
  imports: [InvestigationsModule],
  controllers: [FormsController],
  providers: [FormsService, SubmissionsService],
  exports: [FormsService, SubmissionsService],
})
export class FormsModule {}
