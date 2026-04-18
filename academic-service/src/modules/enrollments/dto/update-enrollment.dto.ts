import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { EnrollmentStatus } from '@prisma/client';

export class UpdateEnrollmentDto {
  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;

  @IsOptional()
  @IsNumber({}, { message: 'Final grade must be a number' })
  finalGrade?: number;

  @IsOptional()
  @IsString()
  letterGrade?: string;
}
