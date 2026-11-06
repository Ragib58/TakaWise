import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { type ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Redis } from 'ioredis';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Atomic fixed-window counter + block flag. Returns {hits, windowTtlMs, blockTtlMs}.
 * KEYS[1]=counter KEYS[2]=block  ARGV[1]=ttlMs ARGV[2]=limit ARGV[3]=blockMs
 */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if blocked <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
return {hits, ttl, blocked}
`;

/**
 * Rate-limit counters shared by every API instance (Phase 7). Without shared
 * storage each instance would allow the full limit, multiplying it by the
 * number of instances. If Redis is unreachable, requests fall back to a local
 * in-memory limiter instead of failing — availability over strictness — and
 * the outage is logged.
 */
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly fallback = new ThrottlerStorageService();
  private readonly redis: Redis;
  private warned = false;

  constructor(
    url: string,
    private readonly prefix: string,
  ) {
    this.redis = new Redis(url, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    this.redis.on('error', () => undefined); // reported via increment() fallback
  }

  /**
   * Connect before serving traffic, so the first requests after start-up are
   * counted in Redis rather than in the fallback. Never blocks start-up for long.
   */
  async connect(timeoutMs = 2_000): Promise<void> {
    try {
      await Promise.race([
        this.redis.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
    } catch {
      this.logger.warn(
        'Redis not reachable at start-up; rate limiting uses the per-instance fallback until it is',
      );
    }
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}:throttle:${throttlerName}:${key}`;
    try {
      const [hits, windowTtl, blockTtl] = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        base,
        `${base}:block`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number];
      this.warned = false;
      return {
        totalHits: hits,
        timeToExpire: Math.max(0, Math.ceil(windowTtl / 1000)),
        isBlocked: blockTtl > 0,
        timeToBlockExpire: Math.max(0, Math.ceil(blockTtl / 1000)),
      };
    } catch (err) {
      if (!this.warned) {
        this.logger.warn(
          { err },
          'Redis unavailable for rate limiting; using per-instance fallback',
        );
        this.warned = true;
      }
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
    this.fallback.onApplicationShutdown?.();
  }
}
