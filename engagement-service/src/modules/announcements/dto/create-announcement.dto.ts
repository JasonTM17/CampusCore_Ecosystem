import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  ANNOUNCEMENT_PRIORITIES,
  AnnouncementPriority,
} from './announcement-priority.dto';

export class CreateAnnouncementDto {
  @IsString()
  title!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_PRIORITIES)
  priority?: AnnouncementPriority;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetRoles?: string[];

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  targetYears?: number[];

  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  publishAt?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;

  @IsOptional()
  @IsString()
  semesterId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  lecturerId?: string;
}
