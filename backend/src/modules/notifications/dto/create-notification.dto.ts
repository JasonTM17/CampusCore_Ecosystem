import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export const NOTIFICATION_TYPES = ['INFO', 'WARNING', 'ERROR', 'SUCCESS'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export class CreateNotificationDto {
  @IsUUID()
  userId!: string;

  @IsString()
  title!: string;

  @IsString()
  message!: string;

  @IsEnum(NOTIFICATION_TYPES)
  type!: NotificationType;

  @IsOptional()
  @IsString()
  link?: string;
}
