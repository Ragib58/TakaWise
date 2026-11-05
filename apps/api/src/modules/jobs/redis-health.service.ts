import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';

/** Readiness probe for Redis; 'disabled' when no REDIS_URL is configured. */
@Injectable()
export class RedisHealth implements OnModuleDestroy {
  private client?: Redis;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async status(): Promise<'up' | 'down' | 'disabled'> {
    if (!this.config.REDIS_URL) return 'disabled';
    this.client ??= new Redis(this.config.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      connectTimeout: 2_000,
      retryStrategy: () => null,
    });
    try {
      if (this.client.status !== 'ready') await this.client.connect();
      return (await this.client.ping()) === 'PONG' ? 'up' : 'down';
    } catch {
      this.client.disconnect();
      this.client = undefined;
      return 'down';
    }
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
  }
}
