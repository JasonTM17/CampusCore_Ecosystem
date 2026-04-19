import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  ANNOUNCEMENT_PRIORITIES,
  AnnouncementPriority,
} from './announcement-priority.dto';

export class ListAnnouncementsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  semesterId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_PRIORITIES)
  priority?: AnnouncementPriority;
}
