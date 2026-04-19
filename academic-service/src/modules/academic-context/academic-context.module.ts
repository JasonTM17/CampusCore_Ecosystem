import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { AcademicContextController } from './academic-context.controller';
import { AcademicContextService } from './academic-context.service';
import { ServiceTokenGuard } from './guards/service-token.guard';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicContextController],
  providers: [AcademicContextService, ServiceTokenGuard],
  exports: [AcademicContextService],
})
export class AcademicContextModule {}
