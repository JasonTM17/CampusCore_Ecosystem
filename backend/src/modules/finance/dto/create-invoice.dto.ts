import { Type } from 'class-transformer';
import { IsArray, IsDate, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { InvoiceItemDto } from './invoice-item.dto';

export class CreateInvoiceDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  semesterId!: string;

  @Type(() => Date)
  @IsDate()
  dueDate!: Date;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items!: InvoiceItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

