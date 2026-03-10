import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LecturersService } from './lecturers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Lecturers')
@Controller('lecturers')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class LecturersController {
  constructor(private lecturersService: LecturersService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create a new lecturer' })
  create(@Body() data: any) {
    return this.lecturersService.create(data);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all lecturers' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.lecturersService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get lecturer by ID' })
  findOne(@Param('id') id: string) {
    return this.lecturersService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update lecturer' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.lecturersService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete lecturer' })
  remove(@Param('id') id: string) {
    return this.lecturersService.remove(id);
  }
}
