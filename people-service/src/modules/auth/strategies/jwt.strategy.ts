import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { ENV } from '../../../config/env.constants';
import { extractAccessTokenFromRequest } from '../auth-session.util';
import { AuthUser } from '../types/auth-user.type';

type JwtPayload = {
  sub: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles?: string[];
  permissions?: string[];
  studentId?: string | null;
  lecturerId?: string | null;
  student?: {
    year?: number | null;
  } | null;
};

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

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (!payload?.sub || !payload?.email) {
      throw new UnauthorizedException('Invalid JWT payload');
    }

    return {
      id: payload.sub,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
      studentId: payload.studentId ?? null,
      lecturerId: payload.lecturerId ?? null,
      student: payload.student ?? null,
    };
  }
}
