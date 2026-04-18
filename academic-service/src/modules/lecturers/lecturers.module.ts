import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { LecturersService } from './lecturers.service';
import { LecturersController } from './lecturers.controller';

@Module({
  imports: [PrismaModule],
  controllers: [LecturersController],
  providers: [LecturersService],
  exports: [LecturersService],
})
export class LecturersModule {}
