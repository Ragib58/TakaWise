import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@takawise/contracts';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Liveness probe. Readiness checks for PostgreSQL and Redis are added in
   * Phase 2 when those clients are introduced.
   */
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
}
