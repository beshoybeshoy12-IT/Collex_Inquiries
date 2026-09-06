import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { MappingTemplatesService } from './mapping-templates.service';
import { InvestigationsModule } from '../investigations/investigations.module';

/**
 * `memoryStorage` on purpose: an uploaded workbook is parsed once and then
 * either staged or discarded, so writing it to a temp file first only adds a
 * cleanup problem. The size cap in `ExcelFilePipe` is what keeps that safe.
 */
@Module({
  imports: [
    InvestigationsModule,
    MulterModule.register({
      limits: { fileSize: 25 * 1024 * 1024, files: 1 },
    }),
  ],
  controllers: [ImportsController],
  providers: [ImportsService, MappingTemplatesService],
  exports: [ImportsService],
})
export class ImportsModule {}
