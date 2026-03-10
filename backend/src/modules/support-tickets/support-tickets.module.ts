import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { SupportTicketsService } from './support-tickets.service';
import { SupportTicketsController } from './support-tickets.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SupportTicketsController],
  providers: [SupportTicketsService],
  exports: [SupportTicketsService],
})
export class SupportTicketsModule {}
