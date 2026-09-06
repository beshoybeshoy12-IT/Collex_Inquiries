import { Module } from '@nestjs/common';
import { InvestigationTypesController } from './investigation-types.controller';
import { InvestigationTypesService } from './investigation-types.service';

@Module({
  controllers: [InvestigationTypesController],
  providers: [InvestigationTypesService],
  exports: [InvestigationTypesService],
})
export class InvestigationTypesModule {}
