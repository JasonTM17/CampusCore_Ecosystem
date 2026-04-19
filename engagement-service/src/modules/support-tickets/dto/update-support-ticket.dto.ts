import { PartialType } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { CreateSupportTicketDto } from './create-support-ticket.dto';
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TicketPriority,
  TicketStatus,
} from './ticket.enums';

export class UpdateSupportTicketDto extends PartialType(
  CreateSupportTicketDto,
) {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;

  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: TicketStatus;
}
