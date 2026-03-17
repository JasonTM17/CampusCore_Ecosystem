import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CachingService } from '../cache/caching.service';

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
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    jest.clearAllMocks();
  });

  describe('check', () => {
    it('should return health status with database and redis', async () => {
      mockCachingService.set.mockResolvedValue(undefined);
      mockCachingService.get.mockResolvedValue('ok');
      mockCachingService.del.mockResolvedValue(undefined);

      const result = await service.check();

      expect(result.status).toBeDefined();
      expect(result.services.database).toBeDefined();
      expect(result.services.redis).toBeDefined();
    });

    it('should return degraded status when database is down', async () => {
      mockPrisma.$queryRaw = jest.fn().mockRejectedValue(new Error('DB Error'));
      mockCachingService.set.mockResolvedValue(undefined);
      mockCachingService.get.mockResolvedValue('ok');

      const result = await service.check();

      expect(result.status).toBe('degraded');
      expect(result.services.database.status).toBe('down');
    });

    it('should return degraded status when redis is down', async () => {
      mockCachingService.set.mockRejectedValue(new Error('Redis Error'));

      const result = await service.check();

      expect(result.status).toBe('degraded');
      expect(result.services.redis.status).toBe('down');
    });
  });
});
