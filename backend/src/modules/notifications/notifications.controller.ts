import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create notification' })
  create(@Body() data: any) {
    return this.notificationsService.create(data);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all notifications' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.notificationsService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get notification by ID' })
  findOne(@Param('id') id: string) {
    return this.notificationsService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update notification' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.notificationsService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete notification' })
  remove(@Param('id') id: string) {
    return this.notificationsService.remove(id);
  }
}
