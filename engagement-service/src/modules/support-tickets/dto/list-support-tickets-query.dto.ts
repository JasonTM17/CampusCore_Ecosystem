import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TICKET_PRIORITIES, TICKET_STATUSES } from './ticket.enums';

export class ListSupportTicketsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsString()
  category?: string;
}
