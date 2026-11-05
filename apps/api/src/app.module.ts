import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { EnvelopeInterceptor } from './common/envelope/envelope.interceptor';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { buildLoggerParams } from './common/logging/logger.config';
import { AppConfigModule } from './config/config.module';
import type { AppConfig } from './config/env';
import { HealthModule } from './modules/health/health.module';

@Module({})
export class AppModule {
  /** Config is injected (not read from process.env) so tests can boot any variant. */
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        LoggerModule.forRoot(buildLoggerParams(config)),
        HealthModule,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
