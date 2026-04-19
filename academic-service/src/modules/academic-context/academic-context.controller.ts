import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AcademicContextService } from './academic-context.service';
import { ServiceTokenGuard } from './guards/service-token.guard';

@ApiExcludeController()
@Controller('internal/academic-context')
@UseGuards(ServiceTokenGuard)
export class AcademicContextController {
  constructor(
    private readonly academicContextService: AcademicContextService,
  ) {}

  @Get('students/:studentId/enrollments')
  getStudentEnrollments(@Param('studentId') studentId: string) {
    return this.academicContextService.getStudentEnrollments(studentId);
  }

  @Get('curricula/:curriculumId')
  getCurriculum(@Param('curriculumId') curriculumId: string) {
    return this.academicContextService.getCurriculum(curriculumId);
  }

  @Get('departments/:departmentId')
  getDepartment(@Param('departmentId') departmentId: string) {
    return this.academicContextService.getDepartment(departmentId);
  }
}
