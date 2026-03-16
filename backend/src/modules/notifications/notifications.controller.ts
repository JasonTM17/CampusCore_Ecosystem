import { Controller, Get, Post, Put, Delete, Patch, Body, Param, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  // ============ USER ENDPOINTS ============

  @Get('my')
  @ApiOperation({ summary: 'Get current user notifications' })
  getMyNotifications(
    @CurrentUser('id') userId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('isRead') isRead?: string,
  ) {
    if (!userId) throw new ForbiddenException('Not authenticated');
    const parsedIsRead = isRead === undefined ? undefined : isRead === 'true';
    return this.notificationsService.findMy(userId, page || 1, limit || 20, parsedIsRead);
  }

  @Get('my/unread-count')
  @ApiOperation({ summary: 'Get current user unread notification count' })
  getMyUnreadCount(@CurrentUser('id') userId: string) {
    if (!userId) throw new ForbiddenException('Not authenticated');
    return this.notificationsService.getUnreadCount(userId);
  }

  @Patch('my/:id/read')
  @ApiOperation({ summary: 'Mark current user notification as read' })
  markMyNotificationRead(@CurrentUser('id') userId: string, @Param('id') id: string) {
    if (!userId) throw new ForbiddenException('Not authenticated');
    return this.notificationsService.markRead(userId, id);
  }

  @Patch('my/read-all')
  @ApiOperation({ summary: 'Mark all current user notifications as read' })
  markAllMyNotificationsRead(@CurrentUser('id') userId: string) {
    if (!userId) throw new ForbiddenException('Not authenticated');
    return this.notificationsService.markAllRead(userId);
  }

  @Delete('my/:id')
  @ApiOperation({ summary: 'Delete current user notification' })
  deleteMyNotification(@CurrentUser('id') userId: string, @Param('id') id: string) {
    if (!userId) throw new ForbiddenException('Not authenticated');
    return this.notificationsService.deleteMyNotification(userId, id);
  }

  // ============ ADMIN ENDPOINTS ============

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create notification' })
  create(@Body() data: CreateNotificationDto) {
    return this.notificationsService.create(data);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all notifications' })
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('userId') userId?: string,
  ) {
    return this.notificationsService.findAll(page || 1, limit || 20, userId);
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get notification by ID' })
  findOne(@Param('id') id: string) {
    return this.notificationsService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update notification' })
  update(@Param('id') id: string, @Body() data: UpdateNotificationDto) {
    return this.notificationsService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete notification' })
  remove(@Param('id') id: string) {
    return this.notificationsService.remove(id);
  }
}
