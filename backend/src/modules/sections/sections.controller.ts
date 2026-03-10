import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SectionsService } from './sections.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Sections')
@Controller('sections')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SectionsController {
  constructor(private sectionsService: SectionsService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Create section' })
  create(@Body() data: any) {
    return this.sectionsService.createSection(data);
  }

  @Get()
  @ApiOperation({ summary: 'Get all sections with filters' })
  findAll(
    @Query('page') page?: number, 
    @Query('limit') limit?: number,
    @Query('semesterId') semesterId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('courseId') courseId?: string,
  ) {
    return this.sectionsService.findAllSections(
      page || 1, 
      limit || 100, 
      semesterId, 
      departmentId, 
      courseId
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get section by ID' })
  findOne(@Param('id') id: string) {
    return this.sectionsService.findOneSection(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Update section' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.sectionsService.updateSection(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete section' })
  remove(@Param('id') id: string) {
    return this.sectionsService.removeSection(id);
  }
}
