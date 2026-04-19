import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsUUID,
  IsNumber,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStudentDto {
  @ApiProperty()
  @IsUUID()
  userId: string;

  @ApiProperty()
  @IsString()
  studentId: string;

  @ApiProperty()
  @IsUUID()
  curriculumId: string;

  @ApiProperty()
  @IsNumber()
  year: number;

  @ApiProperty()
  @IsDateString()
  admissionDate: string;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'GRADUATED', 'SUSPENDED', 'WITHDRAWN'],
  })
  @IsOptional()
  @IsEnum(['ACTIVE', 'GRADUATED', 'SUSPENDED', 'WITHDRAWN'])
  status?: string;
}
