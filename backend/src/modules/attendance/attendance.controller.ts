import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Attendance')
@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AttendanceController {
  constructor(private attendanceService: AttendanceService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Create attendance record' })
  create(@Body() data: any) {
    return this.attendanceService.create(data);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Get all attendance records' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.attendanceService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get attendance record by ID' })
  findOne(@Param('id') id: string) {
    return this.attendanceService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Update attendance record' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.attendanceService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete attendance record' })
  remove(@Param('id') id: string) {
    return this.attendanceService.remove(id);
  }
}
