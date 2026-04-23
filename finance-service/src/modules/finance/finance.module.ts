import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { CoreFinanceContextService } from './core-finance-context.service';
import { FinancePublicController } from './finance-public.controller';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [FinanceController, FinancePublicController],
  providers: [FinanceService, CoreFinanceContextService],
  exports: [FinanceService],
})
export class FinanceModule {}
