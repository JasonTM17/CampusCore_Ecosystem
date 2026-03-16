import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ANNOUNCEMENT_PRIORITIES, AnnouncementPriority } from './announcement-priority.dto';

export class ListAnnouncementsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  semesterId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_PRIORITIES)
  priority?: AnnouncementPriority;
}

