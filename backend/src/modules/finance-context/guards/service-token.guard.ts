import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ENV, ENV_DEFAULTS } from '../../../config/env.constants';

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const providedToken = request.headers['x-service-token'];
    const expectedToken =
      this.configService.get<string>(ENV.INTERNAL_SERVICE_TOKEN) ??
      ENV_DEFAULTS.INTERNAL_SERVICE_TOKEN;

    if (
      typeof providedToken !== 'string' ||
      !expectedToken ||
      providedToken !== expectedToken
    ) {
      throw new ForbiddenException(
        'Internal endpoint requires a valid X-Service-Token header',
      );
    }

    return true;
  }
}
