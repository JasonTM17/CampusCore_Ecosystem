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
import { StudentsService } from './students.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Students')
@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class StudentsController {
  constructor(private studentsService: StudentsService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create a new student' })
  create(@Body() createStudentDto: any) {
    return this.studentsService.create(createStudentDto);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Get all students' })
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ) {
    return this.studentsService.findAll(page || 1, limit || 20, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get student by ID' })
  findOne(@Param('id') id: string) {
    return this.studentsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update student' })
  update(@Param('id') id: string, @Body() updateData: any) {
    return this.studentsService.update(id, updateData);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete student' })
  remove(@Param('id') id: string) {
    return this.studentsService.remove(id);
  }

  @Get(':id/enrollments')
  @ApiOperation({ summary: 'Get student enrollment history' })
  getEnrollmentHistory(@Param('id') id: string) {
    return this.studentsService.getEnrollmentHistory(id);
  }
}
