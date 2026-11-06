import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { EnvelopeInterceptor } from './common/envelope/envelope.interceptor';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { buildLoggerParams } from './common/logging/logger.config';
import { MetricsModule } from './common/metrics/metrics.module';
import { rateLimitModule } from './common/throttling/rate-limit.module';
import { AppConfigModule } from './config/config.module';
import type { AppConfig } from './config/env';
import { DatabaseModule } from './database/database.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AuditModule } from './modules/audit/audit.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { PlanningModule } from './modules/planning.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
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
        rateLimitModule(config),
        MetricsModule,
        DatabaseModule,
        AuditModule,
        EmailModule,
        AuthModule,
        LedgerModule,
        AccountsModule,
        TransactionsModule,
        PlanningModule,
        ReportsModule,
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
