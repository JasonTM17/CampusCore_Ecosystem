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

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Create grade' })
  create(@Body() data: any) {
    return this.gradesService.create(data);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all grades' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.gradesService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get grade by ID' })
  findOne(@Param('id') id: string) {
    return this.gradesService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Update grade' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.gradesService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete grade' })
  remove(@Param('id') id: string) {
    return this.gradesService.remove(id);
  }
}
