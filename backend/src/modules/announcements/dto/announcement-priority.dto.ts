import { IsIn, IsOptional, IsString } from 'class-validator';

export const ANNOUNCEMENT_PRIORITIES = [
  'LOW',
  'NORMAL',
  'HIGH',
  'URGENT',
] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

export class AnnouncementPriorityDto {
  @IsOptional()
  @IsString()
  @IsIn(ANNOUNCEMENT_PRIORITIES)
  priority?: AnnouncementPriority;
}
