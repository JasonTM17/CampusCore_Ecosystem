import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { EnrollmentsService } from './enrollments.service';
import { EnrollmentsController } from './enrollments.controller';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
