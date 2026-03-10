import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
