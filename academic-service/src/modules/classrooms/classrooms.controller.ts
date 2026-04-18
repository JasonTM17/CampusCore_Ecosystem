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
import { ClassroomsService } from './classrooms.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Classrooms')
@Controller('classrooms')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ClassroomsController {
  constructor(private classroomsService: ClassroomsService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create classroom' })
  create(@Body() data: any) {
    return this.classroomsService.create(data);
  }

  @Get()
  @ApiOperation({ summary: 'Get all classrooms' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.classroomsService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get classroom by ID' })
  findOne(@Param('id') id: string) {
    return this.classroomsService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update classroom' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.classroomsService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete classroom' })
  remove(@Param('id') id: string) {
    return this.classroomsService.remove(id);
  }
}
