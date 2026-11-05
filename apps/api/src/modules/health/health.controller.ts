import { Controller, Get, HttpStatus, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { HealthResponse, ReadinessResponse } from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { Public } from '../auth/auth.decorators';
import { RedisHealth } from '../jobs/redis-health.service';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly redis: RedisHealth,
  ) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Get()
  @ApiOkResponse({ description: 'Service is alive' })
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'takawise-api',
      version: this.config.APP_VERSION,
      environment: this.config.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness. PostgreSQL down → 503 (cannot serve). Redis down → 200 "degraded":
   * requests still work, only background jobs (reminders, cleanup) pause.
   */
  @Get('ready')
  @ApiOkResponse({ description: 'Ready to serve traffic (possibly degraded)' })
  @ApiServiceUnavailableResponse({ description: 'The database is unavailable' })
  async ready(): Promise<ReadinessResponse> {
    const [databaseOk, redis] = await Promise.all([this.prisma.isHealthy(), this.redis.status()]);
    if (!databaseOk) {
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        'The service is temporarily unavailable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return {
      status: redis === 'down' ? 'degraded' : 'ok',
      checks: { database: 'up', redis },
      timestamp: new Date().toISOString(),
    };
  }
}
