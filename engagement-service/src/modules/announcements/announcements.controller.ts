import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/types/auth-user.type';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { ListAnnouncementsQueryDto } from './dto/list-announcements-query.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { AnnouncementsService } from './announcements.service';

@ApiTags('Announcements')
@Controller('announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get('my')
  @ApiOperation({ summary: 'Get announcements relevant to current user' })
  getMyAnnouncements(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.announcementsService.findForUser(
      user,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create announcement' })
  create(
    @CurrentUser('id') userId: string,
    @Body() data: CreateAnnouncementDto,
  ) {
    if (!userId) {
      throw new ForbiddenException('Not authenticated');
    }

    return this.announcementsService.create({
      ...data,
      publishedBy: userId,
    });
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all announcements' })
  findAll(@Query() query: ListAnnouncementsQueryDto) {
    return this.announcementsService.findAll(
      query.page ?? 1,
      query.limit ?? 20,
      {
        semesterId: query.semesterId,
        sectionId: query.sectionId,
        priority: query.priority,
      },
    );
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get announcement by ID' })
  findOne(@Param('id') id: string) {
    return this.announcementsService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update announcement' })
  update(@Param('id') id: string, @Body() data: UpdateAnnouncementDto) {
    return this.announcementsService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete announcement' })
  remove(@Param('id') id: string) {
    return this.announcementsService.remove(id);
  }
}
