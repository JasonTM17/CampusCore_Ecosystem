import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    description: 'Refresh token to revoke the current session explicitly',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}
