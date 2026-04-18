import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ENV } from '../../config/env.constants';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const healthService = {
    liveness: jest.fn().mockReturnValue({
      status: 'ok',
      timestamp: '2026-04-17T00:00:00.000Z',
      service: 'campuscore-api',
    }),
    readiness: jest.fn().mockResolvedValue({
      status: 'ok',
      timestamp: '2026-04-17T00:00:00.000Z',
      services: {
        database: { status: 'up', latency: 4 },
        redis: { status: 'up', latency: 2 },
        rabbitmq: { status: 'up', latency: 3 },
      },
    }),
  };

  const configService = {
    get: jest.fn(),
  };

  const controller = new HealthController(
    healthService as never,
    configService as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string, fallback?: unknown) => {
      if (key === ENV.NODE_ENV) {
        return 'test';
      }

      return fallback;
    });
  });

  it('returns the public liveness payload without a key', () => {
    const result = controller.liveness();

    expect(result).toEqual({
      status: 'ok',
      timestamp: '2026-04-17T00:00:00.000Z',
      service: 'campuscore-api',
    });
    expect(healthService.liveness).toHaveBeenCalled();
  });

  it('allows readiness in non-production environments', async () => {
    await expect(controller.readiness()).resolves.toMatchObject({
      status: 'ok',
      services: {
        database: { status: 'up' },
      },
    });
  });

  it('requires a valid readiness key in production', async () => {
    configService.get.mockImplementation((key: string, fallback?: unknown) => {
      if (key === ENV.NODE_ENV) {
        return 'production';
      }

      if (key === ENV.HEALTH_READINESS_KEY) {
        return 'production-readiness-key';
      }

      return fallback;
    });

    expect(() => controller.readiness()).toThrow(ForbiddenException);
    expect(() => controller.readiness('wrong-key')).toThrow(ForbiddenException);
    await expect(
      controller.readiness('production-readiness-key'),
    ).resolves.toMatchObject({
      status: 'ok',
      services: {
        redis: { status: 'up' },
      },
    });
  });

  it('keeps the legacy readiness alias behind the same gate', async () => {
    configService.get.mockImplementation((key: string, fallback?: unknown) => {
      if (key === ENV.NODE_ENV) {
        return 'production';
      }

      if (key === ENV.HEALTH_READINESS_KEY) {
        return 'alias-readiness-key';
      }

      return fallback;
    });

    await expect(
      controller.check('alias-readiness-key'),
    ).resolves.toMatchObject({
      services: {
        rabbitmq: { status: 'up' },
      },
    });
  });
});
