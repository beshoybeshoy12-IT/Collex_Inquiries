import { Module } from '@nestjs/common';
import { GeographyController } from './geography.controller';

/** Read-only over a shared catalogue, so there is no service and no state. */
@Module({ controllers: [GeographyController] })
export class GeographyModule {}
