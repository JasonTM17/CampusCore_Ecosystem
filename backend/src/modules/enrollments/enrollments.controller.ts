import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EnrollmentsService } from './enrollments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Enrollments')
@Controller('enrollments')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EnrollmentsController {
  constructor(private enrollmentsService: EnrollmentsService) {}

  @Post('enroll')
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  @ApiOperation({ summary: 'Enroll student in a section' })
  enrollStudent(@Body() body: { studentId: string; sectionId: string }) {
    return this.enrollmentsService.enrollStudent(body.studentId, body.sectionId);
  }

  @Post(':id/drop')
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  @ApiOperation({ summary: 'Drop enrollment' })
  dropEnrollment(@Param('id') id: string, @Body() body: { studentId: string }) {
    return this.enrollmentsService.dropEnrollment(id, body.studentId);
  }

  @Get('my')
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  @ApiOperation({ summary: 'Get current student enrollments' })
  getMyEnrollments(@Request() req: any, @Query('semesterId') semesterId?: string) {
    return this.enrollmentsService.getStudentEnrollments(req.user.studentId, semesterId);
  }

  @Get('student/:studentId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  @ApiOperation({ summary: 'Get student enrollments' })
  getStudentEnrollments(@Param('studentId') studentId: string, @Query('semesterId') semesterId?: string) {
    return this.enrollmentsService.getStudentEnrollments(studentId, semesterId);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all enrollments' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number, @Query('status') status?: string) {
    return this.enrollmentsService.findAll(page || 1, limit || 20, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get enrollment by ID' })
  findOne(@Param('id') id: string) {
    return this.enrollmentsService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update enrollment' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.enrollmentsService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete enrollment' })
  remove(@Param('id') id: string) {
    return this.enrollmentsService.remove(id);
  }
}
