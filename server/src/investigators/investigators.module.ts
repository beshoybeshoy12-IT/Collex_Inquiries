import { Module } from '@nestjs/common';
import { InvestigatorsController } from './investigators.controller';
import { InvestigatorsService } from './investigators.service';

@Module({
  controllers: [InvestigatorsController],
  providers: [InvestigatorsService],
  exports: [InvestigatorsService],
})
export class InvestigatorsModule {}
