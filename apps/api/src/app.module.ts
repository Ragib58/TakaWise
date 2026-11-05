import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { EnvelopeInterceptor } from './common/envelope/envelope.interceptor';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { buildLoggerParams } from './common/logging/logger.config';
import { AppConfigModule } from './config/config.module';
import type { AppConfig } from './config/env';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { EmailModule } from './modules/email/email.module';
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
        // In-memory counters: correct for a single API instance. Move to Redis
        // storage before running more than one instance (Phase 7).
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
          skipIf: () => !config.THROTTLE_ENABLED,
        }),
        DatabaseModule,
        AuditModule,
        EmailModule,
        AuthModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        // Guard order matters: rate limit first, then authentication (default deny).
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
