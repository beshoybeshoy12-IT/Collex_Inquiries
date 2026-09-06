import { Module } from '@nestjs/common';
import { QcController } from './qc.controller';
import { QcService } from './qc.service';
import { InvestigationsModule } from '../investigations/investigations.module';

@Module({
  imports: [InvestigationsModule],
  controllers: [QcController],
  providers: [QcService],
  exports: [QcService],
})
export class QcModule {}
