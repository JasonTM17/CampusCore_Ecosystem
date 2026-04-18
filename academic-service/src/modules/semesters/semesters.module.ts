import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { SemestersService } from './semesters.service';
import { SemestersController } from './semesters.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SemestersController],
  providers: [SemestersService],
  exports: [SemestersService],
})
export class SemestersModule {}
