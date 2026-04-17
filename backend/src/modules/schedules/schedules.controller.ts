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
import { SchedulesService } from './schedules.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Schedules')
@Controller('schedules')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SchedulesController {
  constructor(private schedulesService: SchedulesService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Create schedule' })
  create(@Body() data: any) {
    return this.schedulesService.create(data);
  }

  @Get()
  @ApiOperation({ summary: 'Get all schedules' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.schedulesService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get schedule by ID' })
  findOne(@Param('id') id: string) {
    return this.schedulesService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Update schedule' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.schedulesService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete schedule' })
  remove(@Param('id') id: string) {
    return this.schedulesService.remove(id);
  }
}
