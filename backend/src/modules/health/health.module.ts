import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { CachingService } from '../cache/caching.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [CacheModule],
  controllers: [HealthController],
  providers: [HealthService, CachingService],
  exports: [HealthService],
})
export class HealthModule {}
