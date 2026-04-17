import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { EnrollmentsService } from './enrollments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentStudent } from '../auth/decorators/current-user.decorator';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';

@ApiTags('Enrollments')
@Controller('enrollments')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EnrollmentsController {
  constructor(private enrollmentsService: EnrollmentsService) {}

  @Post('enroll')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Enroll current student in a section' })
  enrollStudent(
    @CurrentStudent() studentId: string,
    @Body() body: { sectionId: string },
  ) {
    return this.enrollmentsService.enrollStudent(studentId, body.sectionId);
  }

  @Post(':id/drop')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Drop enrollment' })
  dropEnrollment(@CurrentStudent() studentId: string, @Param('id') id: string) {
    return this.enrollmentsService.dropEnrollment(id, studentId);
  }

  @Get('my')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Get current student enrollments' })
  getMyEnrollments(
    @CurrentStudent() studentId: string,
    @Query('semesterId') semesterId?: string,
  ) {
    return this.enrollmentsService.getStudentEnrollments(studentId, semesterId);
  }

  @Get('my/grades')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Get current student grades' })
  getMyGrades(
    @CurrentStudent() studentId: string,
    @Query('semesterId') semesterId?: string,
  ) {
    return this.enrollmentsService.getStudentGrades(studentId, semesterId);
  }

  @Get('my/transcript')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Get current student transcript' })
  getMyTranscript(@CurrentStudent() studentId: string) {
    return this.enrollmentsService.getStudentTranscript(studentId);
  }

  @Get('student/:studentId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get student enrollments (admin only)' })
  getStudentEnrollments(
    @Param('studentId') studentId: string,
    @Query('semesterId') semesterId?: string,
  ) {
    return this.enrollmentsService.getStudentEnrollments(studentId, semesterId);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all enrollments' })
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('semesterId') semesterId?: string,
    @Query('studentId') studentId?: string,
    @Query('courseId') courseId?: string,
    @Query('sectionId') sectionId?: string,
  ) {
    return this.enrollmentsService.findAll(
      page || 1,
      limit || 20,
      status,
      semesterId,
      studentId,
      courseId,
      sectionId,
    );
  }

  @Get('export/csv')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Export enrollments as CSV' })
  async exportCsv(
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('semesterId') semesterId?: string,
    @Query('studentId') studentId?: string,
    @Query('courseId') courseId?: string,
    @Query('sectionId') sectionId?: string,
  ) {
    const csv = await this.enrollmentsService.exportAll(
      status,
      semesterId,
      studentId,
      courseId,
      sectionId,
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=enrollments.csv',
    );
    res.send(csv);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get enrollment by ID' })
  findOne(@Param('id') id: string) {
    return this.enrollmentsService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update enrollment' })
  update(@Param('id') id: string, @Body() data: UpdateEnrollmentDto) {
    return this.enrollmentsService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete enrollment' })
  remove(@Param('id') id: string) {
    return this.enrollmentsService.remove(id);
  }
}
