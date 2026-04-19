import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description:
      'Legacy refresh token body for non-browser clients. Browser sessions may use the refresh cookie instead.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}
