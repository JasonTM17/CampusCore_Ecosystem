import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { FinanceContextController } from './finance-context.controller';
import { FinanceContextService } from './finance-context.service';
import { ServiceTokenGuard } from './guards/service-token.guard';

@Module({
  imports: [PrismaModule],
  controllers: [FinanceContextController],
  providers: [FinanceContextService, ServiceTokenGuard],
  exports: [FinanceContextService],
})
export class FinanceContextModule {}
