import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CachingService } from '../cache/caching.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import {
  CACHE_RUNTIME_STATUS,
  CacheRuntimeStatus,
} from '../cache/cache.constants';

describe('HealthService', () => {
  let service: HealthService;

  const mockPrisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
  };

  const mockCachingService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const mockRabbitMQService = {
    isConfigured: jest.fn(),
    isConnected: jest.fn(),
  };
  const mockCacheRuntimeStatus: CacheRuntimeStatus = {
    backend: 'redis',
    redisConfigured: true,
    fallbackToMemory: false,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: CachingService,
          useValue: mockCachingService,
        },
        {
          provide: RabbitMQService,
          useValue: mockRabbitMQService,
        },
        {
          provide: CACHE_RUNTIME_STATUS,
          useValue: mockCacheRuntimeStatus,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    jest.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockCachingService.set.mockResolvedValue(undefined);
    mockCachingService.get.mockResolvedValue('ok');
    mockCachingService.del.mockResolvedValue(undefined);
    mockRabbitMQService.isConfigured.mockReturnValue(true);
    mockRabbitMQService.isConnected.mockReturnValue(true);
    mockCacheRuntimeStatus.backend = 'redis';
    mockCacheRuntimeStatus.redisConfigured = true;
    mockCacheRuntimeStatus.fallbackToMemory = false;
  });

  describe('check', () => {
    it('should return health status with database and redis', async () => {
      mockCachingService.set.mockResolvedValue(undefined);
      mockCachingService.get.mockResolvedValue('ok');
      mockCachingService.del.mockResolvedValue(undefined);
      mockRabbitMQService.isConfigured.mockReturnValue(true);
      mockRabbitMQService.isConnected.mockReturnValue(true);

      const result = await service.check();

      expect(result.status).toBeDefined();
      expect(result.services.database).toBeDefined();
      expect(result.services.redis).toBeDefined();
      expect(result.services.rabbitmq).toBeDefined();
    });

    it('should return degraded status when database is down', async () => {
      mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('DB Error'));

      const result = await service.check();

      expect(result.status).toBe('degraded');
      expect(result.services.database.status).toBe('down');
    });

    it('should return degraded status when redis is down', async () => {
      mockCachingService.set.mockRejectedValue(new Error('Redis Error'));
      mockRabbitMQService.isConfigured.mockReturnValue(true);
      mockRabbitMQService.isConnected.mockReturnValue(true);

      const result = await service.check();

      expect(result.status).toBe('degraded');
      expect(result.services.redis.status).toBe('down');
    });

    it('should surface Redis fallback as degraded when Redis is configured', async () => {
      mockCacheRuntimeStatus.backend = 'memory';
      mockCacheRuntimeStatus.redisConfigured = true;
      mockRabbitMQService.isConfigured.mockReturnValue(true);
      mockRabbitMQService.isConnected.mockReturnValue(true);

      const result = await service.check();

      expect(result.status).toBe('degraded');
      expect(result.services.redis.status).toBe('down');
      expect(mockCachingService.set).not.toHaveBeenCalled();
    });

    it('should report Redis as not configured when using the memory cache intentionally', async () => {
      mockCacheRuntimeStatus.backend = 'memory';
      mockCacheRuntimeStatus.redisConfigured = false;
      mockRabbitMQService.isConfigured.mockReturnValue(true);
      mockRabbitMQService.isConnected.mockReturnValue(true);

      const result = await service.check();

      expect(result.status).toBe('ok');
      expect(result.services.redis.status).toBe('not_configured');
      expect(mockCachingService.set).not.toHaveBeenCalled();
    });

    it('should return degraded status when rabbitmq is down', async () => {
      mockCachingService.set.mockResolvedValue(undefined);
      mockCachingService.get.mockResolvedValue('ok');
      mockCachingService.del.mockResolvedValue(undefined);
      mockRabbitMQService.isConfigured.mockReturnValue(true);
      mockRabbitMQService.isConnected.mockReturnValue(false);

      const result = await service.check();

      expect(result.status).toBe('degraded');
      expect(result.services.rabbitmq.status).toBe('down');
    });

    it('should report RabbitMQ as not configured when disabled intentionally', async () => {
      mockCachingService.set.mockResolvedValue(undefined);
      mockCachingService.get.mockResolvedValue('ok');
      mockCachingService.del.mockResolvedValue(undefined);
      mockRabbitMQService.isConfigured.mockReturnValue(false);

      const result = await service.check();

      expect(result.status).toBe('ok');
      expect(result.services.rabbitmq.status).toBe('not_configured');
      expect(mockRabbitMQService.isConnected).not.toHaveBeenCalled();
    });
  });
});
