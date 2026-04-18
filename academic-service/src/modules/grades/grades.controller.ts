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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GradesService } from './grades.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentLecturer } from '../auth/decorators/current-user.decorator';

@ApiTags('Grades')
@Controller('grades')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class GradesController {
  constructor(private gradesService: GradesService) {}

  // ============ GRADE ITEMS ============

  @Post('items')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Create grade item' })
  createGradeItem(@Body() data: any) {
    return this.gradesService.createGradeItem(data);
  }

  @Get('items')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all grade items' })
  findAllGradeItems(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.gradesService.findAllGradeItems(page || 1, limit || 20);
  }

  @Get('items/section/:sectionId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Get grade items by section' })
  findGradeItemsBySection(@Param('sectionId') sectionId: string) {
    return this.gradesService.findGradeItemsBySection(sectionId);
  }

  @Get('items/lecturer/my')
  @Roles('LECTURER')
  @ApiOperation({ summary: 'Get grade items for lecturer sections' })
  findMyGradeItems(@CurrentLecturer() lecturerId: string) {
    return this.gradesService.findGradeItemsByLecturer(lecturerId);
  }

  @Get('items/:id')
  @ApiOperation({ summary: 'Get grade item by ID' })
  findOneGradeItem(@Param('id') id: string) {
    return this.gradesService.findOneGradeItem(id);
  }

  @Put('items/:id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Update grade item' })
  updateGradeItem(@Param('id') id: string, @Body() data: any) {
    return this.gradesService.updateGradeItem(id, data);
  }

  @Delete('items/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete grade item' })
  removeGradeItem(@Param('id') id: string) {
    return this.gradesService.removeGradeItem(id);
  }

  // ============ STUDENT GRADES ============

  @Post('student-grades')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Create student grade' })
  createStudentGrade(@Body() data: any) {
    return this.gradesService.createStudentGrade(data);
  }

  @Post('student-grades/bulk')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Create multiple student grades' })
  createBulkStudentGrades(@Body() data: { grades: any[] }) {
    return this.gradesService.createBulkStudentGrades(data.grades);
  }

  @Get('student-grades')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all student grades' })
  findAllStudentGrades(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.gradesService.findAllStudentGrades(page || 1, limit || 20);
  }

  @Get('student-grades/section/:sectionId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Get student grades by section' })
  findStudentGradesBySection(@Param('sectionId') sectionId: string) {
    return this.gradesService.findStudentGradesBySection(sectionId);
  }

  @Get('student-grades/lecturer/my')
  @Roles('LECTURER')
  @ApiOperation({ summary: 'Get student grades for lecturer sections' })
  findMyStudentGrades(
    @CurrentLecturer() lecturerId: string,
    @Query('sectionId') sectionId?: string,
  ) {
    return this.gradesService.findStudentGradesByLecturer(
      lecturerId,
      sectionId,
    );
  }

  @Get('student-grades/enrollment/:enrollmentId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Get student grades by enrollment' })
  findStudentGradesByEnrollment(@Param('enrollmentId') enrollmentId: string) {
    return this.gradesService.findStudentGradesByEnrollment(enrollmentId);
  }

  @Get('student-grades/:id')
  @ApiOperation({ summary: 'Get student grade by ID' })
  findOneStudentGrade(@Param('id') id: string) {
    return this.gradesService.findOneStudentGrade(id);
  }

  @Put('student-grades/:id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Update student grade' })
  updateStudentGrade(@Param('id') id: string, @Body() data: any) {
    return this.gradesService.updateStudentGrade(id, data);
  }

  @Delete('student-grades/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete student grade' })
  removeStudentGrade(@Param('id') id: string) {
    return this.gradesService.removeStudentGrade(id);
  }
}
