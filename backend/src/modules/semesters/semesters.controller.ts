import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SemestersService } from './semesters.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Semesters')
@Controller('semesters')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SemestersController {
  constructor(private semestersService: SemestersService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create semester' })
  create(@Body() data: any) {
    return this.semestersService.create(data);
  }

  @Get()
  @ApiOperation({ summary: 'Get all semesters' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.semestersService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get semester by ID' })
  findOne(@Param('id') id: string) {
    return this.semestersService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update semester' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.semestersService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete semester' })
  remove(@Param('id') id: string) {
    return this.semestersService.remove(id);
  }
}
