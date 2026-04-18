import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { CurriculaService } from './curricula.service';
import { CurriculaController } from './curricula.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CurriculaController],
  providers: [CurriculaService],
  exports: [CurriculaService],
})
export class CurriculaModule {}
