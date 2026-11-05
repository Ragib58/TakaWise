import { Controller, Get, HttpStatus, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { HealthResponse, ReadinessResponse } from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
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

  /** Readiness: dependencies reachable. Redis is added with BullMQ (Phase 5). */
  @Get('ready')
  @ApiOkResponse({ description: 'Ready to serve traffic' })
  @ApiServiceUnavailableResponse({ description: 'A dependency is unavailable' })
  async ready(): Promise<ReadinessResponse> {
    const database = (await this.prisma.isHealthy()) ? 'up' : 'down';
    if (database === 'down') {
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        'The service is temporarily unavailable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: 'ok', checks: { database }, timestamp: new Date().toISOString() };
  }
}
