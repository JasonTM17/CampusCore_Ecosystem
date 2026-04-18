import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { AcademicYearsService } from './academic-years.service';
import { AcademicYearsController } from './academic-years.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicYearsController],
  providers: [AcademicYearsService],
  exports: [AcademicYearsService],
})
export class AcademicYearsModule {}
