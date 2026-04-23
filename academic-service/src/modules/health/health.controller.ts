import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import {
  HEALTH_READINESS_HEADER,
  HEALTH_READINESS_HEADER_NAME,
} from '@campuscore/platform-auth';
import { HealthService } from './health.service';
import { ENV } from '../../config/env.constants';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly configService: ConfigService,
  ) {}

  @Get('liveness')
  @ApiOperation({ summary: 'Public liveness probe' })
  liveness() {
    return this.healthService.liveness();
  }

  @Get('readiness')
  @ApiOperation({ summary: 'Internal readiness probe' })
  readiness(@Headers(HEALTH_READINESS_HEADER) healthKey?: string) {
    this.assertReadinessAccess(healthKey);
    return this.healthService.readiness();
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Internal Prometheus metrics surface' })
  metrics(@Headers(HEALTH_READINESS_HEADER) healthKey?: string) {
    this.assertReadinessAccess(healthKey);
    return this.healthService.metrics();
  }

  private assertReadinessAccess(providedKey?: string) {
    const nodeEnv = this.configService.get<string>(ENV.NODE_ENV, 'development');
    if (nodeEnv !== 'production') {
      return;
    }

    const expectedKey = this.configService.get<string | undefined>(
      ENV.HEALTH_READINESS_KEY,
    );
    if (!expectedKey || providedKey !== expectedKey) {
      throw new ForbiddenException(
        `Readiness probe requires a valid ${HEALTH_READINESS_HEADER_NAME} header`,
      );
    }
  }
}
