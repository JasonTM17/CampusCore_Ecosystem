import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { ENV } from '../../../config/env.constants';
import { extractRefreshTokenFromRequest } from '../auth-session.util';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromBodyField('refreshToken'),
        (request: Request) => extractRefreshTokenFromRequest(request),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>(ENV.JWT_REFRESH_SECRET),
    });
  }

  async validate(payload: any) {
    return payload;
  }
}
