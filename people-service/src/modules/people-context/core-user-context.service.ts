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

export type CoreUserSnapshot = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
};

@Injectable()
export class CoreUserContextService {
  private readonly baseUrl: string;
  private readonly serviceToken: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>(ENV.CORE_API_INTERNAL_URL) ??
      ENV_DEFAULTS.CORE_API_INTERNAL_URL
    ).replace(/\/+$/u, '');
    this.serviceToken = this.configService.getOrThrow<string>(
      ENV.INTERNAL_SERVICE_TOKEN,
    );
  }

  async getUser(userId: string): Promise<CoreUserSnapshot> {
    return this.fetchJson<CoreUserSnapshot>(
      `${INTERNAL_API_PREFIX}/people-context/users/${userId}`,
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
        `Core user context not found for ${pathname}`,
      );
    }

    if (response.status === 400) {
      throw new BadRequestException(
        `Invalid core user context request for ${pathname}`,
      );
    }

    if (!response.ok) {
      throw new BadGatewayException(
        `Core API user context request failed with status ${response.status}`,
      );
    }

    return (await response.json()) as T;
  }
}
