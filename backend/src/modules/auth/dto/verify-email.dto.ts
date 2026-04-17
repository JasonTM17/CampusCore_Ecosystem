import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiPropertyOptional({
    description: 'Verification token from query string or body',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  token?: string;
}
