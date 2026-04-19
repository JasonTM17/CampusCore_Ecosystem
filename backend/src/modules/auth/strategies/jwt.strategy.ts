import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import {
  extractAccessTokenFromRequest,
  normalizeJwtPayload,
  type JwtPayloadLike,
} from '@campuscore/platform-auth';
import { ENV } from '../../../config/env.constants';
import { AuthUser } from '../types/auth-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: Request) => extractAccessTokenFromRequest(request),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>(ENV.JWT_SECRET),
    });
  }

  async validate(payload: JwtPayloadLike): Promise<AuthUser> {
    if (!payload?.sub || !payload?.email) {
      throw new UnauthorizedException();
    }

    return normalizeJwtPayload(payload) as AuthUser;
  }
}
