import { IsString, IsOptional, IsEnum, IsDateString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStudentDto {
  @ApiProperty()
  @IsUUID()
  userId: string;

  @ApiProperty()
  @IsString()
  studentCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  major?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'GRADUATED', 'SUSPENDED', 'DROPPED'] })
  @IsOptional()
  @IsEnum(['ACTIVE', 'GRADUATED', 'SUSPENDED', 'DROPPED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  enrollmentDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
