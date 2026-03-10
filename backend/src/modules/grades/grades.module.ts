import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { GradesService } from './grades.service';
import { GradesController } from './grades.controller';

@Module({
  imports: [PrismaModule],
  controllers: [GradesController],
  providers: [GradesService],
  exports: [GradesService],
})
export class GradesModule {}
