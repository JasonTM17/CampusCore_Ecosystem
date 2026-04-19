import { IsString } from 'class-validator';

export class AssignSupportTicketDto {
  @IsString()
  assignedTo!: string;
}
