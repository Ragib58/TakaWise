import { Controller, Get, Headers, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { safeEqual } from '../../modules/auth/crypto/secure-tokens';
import { Public } from '../../modules/auth/auth.decorators';
import { SkipEnvelope } from '../envelope/skip-envelope.decorator';
import { AppException } from '../errors/app.exception';
import { MetricsService } from './metrics.service';

/**
 * GET /api/v1/metrics (Prometheus text format).
 * - METRICS_TOKEN set → requires `Authorization: Bearer <token>`.
 * - Unset → open outside production, 404 in production (never public by accident).
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  @SkipEnvelope()
  async scrape(
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const token = this.config.METRICS_TOKEN;
    if (!token && this.config.isProduction) {
      throw new AppException(
        'NOT_FOUND',
        'The requested resource was not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (token && !safeEqual(authorization ?? '', `Bearer ${token}`)) {
      throw new AppException(
        'UNAUTHENTICATED',
        'Authentication is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    res.setHeader('Content-Type', this.metrics.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(await this.metrics.render());
  }
}
