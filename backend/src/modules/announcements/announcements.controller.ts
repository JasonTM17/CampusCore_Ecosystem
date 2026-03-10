import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnnouncementsService } from './announcements.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Announcements')
@Controller('announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AnnouncementsController {
  constructor(private announcementsService: AnnouncementsService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Create announcement' })
  create(@Body() data: any) {
    return this.announcementsService.create(data);
  }

  @Get()
  @ApiOperation({ summary: 'Get all announcements' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.announcementsService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get announcement by ID' })
  findOne(@Param('id') id: string) {
    return this.announcementsService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Update announcement' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.announcementsService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete announcement' })
  remove(@Param('id') id: string) {
    return this.announcementsService.remove(id);
  }
}
