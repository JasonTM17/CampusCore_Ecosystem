import { Module } from '@nestjs/common';
import { AcademicContextService } from './academic-context.service';
import { AuthUserContextService } from './auth-user-context.service';

@Module({
  providers: [AcademicContextService, AuthUserContextService],
  exports: [AcademicContextService, AuthUserContextService],
})
export class PeopleContextModule {}
