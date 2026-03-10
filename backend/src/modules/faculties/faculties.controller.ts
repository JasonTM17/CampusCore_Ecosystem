import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FacultiesService } from './faculties.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Faculties')
@Controller('faculties')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class FacultiesController {
  constructor(private facultiesService: FacultiesService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create a new faculty' })
  create(@Body() data: any) {
    return this.facultiesService.create(data);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all faculties' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.facultiesService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get faculty by ID' })
  findOne(@Param('id') id: string) {
    return this.facultiesService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update faculty' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.facultiesService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete faculty' })
  remove(@Param('id') id: string) {
    return this.facultiesService.remove(id);
  }
}
