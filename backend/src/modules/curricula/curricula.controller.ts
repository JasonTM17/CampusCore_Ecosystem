import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CurriculaService } from './curricula.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Curricula')
@Controller('curricula')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CurriculaController {
  constructor(private curriculaService: CurriculaService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create curriculum' })
  create(@Body() data: any) {
    return this.curriculaService.create(data);
  }

  @Get()
  @ApiOperation({ summary: 'Get all curricula' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.curriculaService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get curriculum by ID' })
  findOne(@Param('id') id: string) {
    return this.curriculaService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update curriculum' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.curriculaService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete curriculum' })
  remove(@Param('id') id: string) {
    return this.curriculaService.remove(id);
  }
}
