import { IsIn, IsOptional, IsString } from 'class-validator';
import { TICKET_PRIORITIES, TicketPriority } from './ticket.enums';

export class CreateSupportTicketDto {
  @IsString()
  subject!: string;

  @IsString()
  description!: string;

  @IsString()
  category!: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;
}
