import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GradesService } from './grades.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Grades')
@Controller('grades')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class GradesController {
  constructor(private gradesService: GradesService) {}

  @Post('items')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Create grade item' })
  createGradeItem(@Body() data: any) {
    return this.gradesService.createGradeItem(data);
  }

  @Get('items')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all grade items' })
  findAllGradeItems(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.gradesService.findAllGradeItems(page || 1, limit || 20);
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

  @Post('student-grades')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Create student grade' })
  createStudentGrade(@Body() data: any) {
    return this.gradesService.createStudentGrade(data);
  }

  @Get('student-grades')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all student grades' })
  findAllStudentGrades(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.gradesService.findAllStudentGrades(page || 1, limit || 20);
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
