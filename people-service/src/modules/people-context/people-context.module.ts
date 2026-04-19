import { Module } from '@nestjs/common';
import { AcademicContextService } from './academic-context.service';
import { CoreUserContextService } from './core-user-context.service';

@Module({
  providers: [AcademicContextService, CoreUserContextService],
  exports: [AcademicContextService, CoreUserContextService],
})
export class PeopleContextModule {}
