import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateTicketResponseDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}
