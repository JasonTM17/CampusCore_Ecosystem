import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject } from 'class-validator';
import { RABBITMQ_ALLOWED_QUEUES } from '../rabbitmq.constants';

export class PublishMessageDto {
  @ApiProperty({ enum: RABBITMQ_ALLOWED_QUEUES })
  @IsIn(RABBITMQ_ALLOWED_QUEUES)
  queue!: (typeof RABBITMQ_ALLOWED_QUEUES)[number];

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  message!: Record<string, unknown>;
}
