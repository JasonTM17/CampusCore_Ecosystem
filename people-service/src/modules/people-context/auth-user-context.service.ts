import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  INTERNAL_API_PREFIX,
  INTERNAL_SERVICE_TOKEN_HEADER_NAME,
} from '@campuscore/platform-auth';
import { ENV, ENV_DEFAULTS } from '../../config/env.constants';

export type AuthUserSnapshot = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  status?: string;
};

@Injectable()
export class AuthUserContextService {
  private readonly baseUrl: string;
  private readonly serviceToken: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>(ENV.AUTH_SERVICE_INTERNAL_URL) ??
      ENV_DEFAULTS.AUTH_SERVICE_INTERNAL_URL
    ).replace(/\/+$/u, '');
    this.serviceToken = this.configService.getOrThrow<string>(
      ENV.INTERNAL_SERVICE_TOKEN,
    );
  }

  async getUser(userId: string): Promise<AuthUserSnapshot> {
    return this.fetchJson<AuthUserSnapshot>(
      `${INTERNAL_API_PREFIX}/auth-context/users/${userId}`,
    );
  }

  private async fetchJson<T>(pathname: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      headers: {
        [INTERNAL_SERVICE_TOKEN_HEADER_NAME]: this.serviceToken,
      },
    });

    if (response.status === 404) {
      throw new NotFoundException(
        `Auth user context not found for ${pathname}`,
      );
    }

    if (response.status === 400) {
      throw new BadRequestException(
        `Invalid auth user context request for ${pathname}`,
      );
    }

    if (!response.ok) {
      throw new BadGatewayException(
        `Auth service user context request failed with status ${response.status}`,
      );
    }

    return (await response.json()) as T;
  }
}
