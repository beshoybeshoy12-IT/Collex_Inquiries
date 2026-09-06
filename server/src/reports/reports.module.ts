import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportRendererService } from './report-renderer.service';
import { InvestigationsModule } from '../investigations/investigations.module';

/**
 * Exported so the worker process can construct the same service and run the
 * same `generate` method. One implementation, two entry points — a separate
 * worker-side renderer would drift from the one the API previews with.
 */
@Module({
  imports: [InvestigationsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportRendererService],
  exports: [ReportsService, ReportRendererService],
})
export class ReportsModule {}
