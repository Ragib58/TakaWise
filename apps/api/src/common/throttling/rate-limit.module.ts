import { type DynamicModule, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { AppConfig } from '../../config/env';
import { RedisThrottlerStorage } from './redis-throttler.storage';

export const RATE_LIMIT_STORAGE = Symbol('RATE_LIMIT_STORAGE');

/** Registers the storage as a provider so Nest closes its Redis connection on shutdown. */
@Module({})
class RateLimitStorageModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: RateLimitStorageModule,
      providers: [
        {
          provide: RATE_LIMIT_STORAGE,
          useFactory: async () => {
            if (!config.REDIS_URL) return null;
            const storage = new RedisThrottlerStorage(config.REDIS_URL, config.JOBS_PREFIX);
            await storage.connect();
            return storage;
          },
        },
      ],
      exports: [RATE_LIMIT_STORAGE],
    };
  }
}

/**
 * Global default 120 requests/min per client, with stricter per-route limits on
 * auth and export endpoints. Counters live in Redis when REDIS_URL is set
 * (shared across instances), otherwise in process memory.
 */
export function rateLimitModule(config: AppConfig): DynamicModule {
  return ThrottlerModule.forRootAsync({
    imports: [RateLimitStorageModule.register(config)],
    inject: [RATE_LIMIT_STORAGE],
    useFactory: (storage: RedisThrottlerStorage | null) => ({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      skipIf: () => !config.THROTTLE_ENABLED,
      ...(storage ? { storage } : {}),
    }),
  });
}
