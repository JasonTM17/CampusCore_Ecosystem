import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { FinanceContextService } from './finance-context.service';
import { ServiceTokenGuard } from './guards/service-token.guard';

@ApiExcludeController()
@Controller('internal/finance-context')
@UseGuards(ServiceTokenGuard)
export class FinanceContextController {
  constructor(private readonly financeContextService: FinanceContextService) {}

  @Get('students/:studentId')
  getStudent(@Param('studentId') studentId: string) {
    return this.financeContextService.getStudent(studentId);
  }

  @Get('semesters/:semesterId')
  getSemester(@Param('semesterId') semesterId: string) {
    return this.financeContextService.getSemester(semesterId);
  }

  @Get('semesters/:semesterId/billable-students')
  getBillableStudents(@Param('semesterId') semesterId: string) {
    return this.financeContextService.getBillableStudents(semesterId);
  }
}
