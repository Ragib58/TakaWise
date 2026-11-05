import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Nest-managed Prisma client. Connects lazily on first query, so the process can
 * start (and report not-ready) while the database is unavailable.
 * Prisma entities must never be returned to clients; map to contract DTOs.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.DATABASE_URL,
        max: config.DATABASE_POOL_MAX,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Cheap connectivity probe for readiness checks. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
