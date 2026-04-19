import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { AuthContextController } from './auth-context.controller';
import { AuthContextService } from './auth-context.service';
import { PeopleContextAliasController } from './people-context-alias.controller';
import { ServiceTokenGuard } from './guards/service-token.guard';

@Module({
  imports: [PrismaModule],
  controllers: [AuthContextController, PeopleContextAliasController],
  providers: [AuthContextService, ServiceTokenGuard],
  exports: [AuthContextService],
})
export class AuthContextModule {}
