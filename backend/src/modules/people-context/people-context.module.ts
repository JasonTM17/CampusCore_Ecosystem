import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { PeopleContextController } from './people-context.controller';
import { PeopleContextService } from './people-context.service';

@Module({
  imports: [PrismaModule],
  controllers: [PeopleContextController],
  providers: [PeopleContextService],
  exports: [PeopleContextService],
})
export class PeopleContextModule {}
