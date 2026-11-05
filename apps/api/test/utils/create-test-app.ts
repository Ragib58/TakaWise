import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import { loadConfig } from '../../src/config/env';
import {
  EMAIL_SENDER,
  type EmailMessage,
  type EmailSender,
} from '../../src/modules/email/email.types';
import { TEST_DATABASE_URL } from './test-database';

export const TEST_ORIGIN = 'http://localhost:3100';

/** Captures outgoing email so tests can read verification/reset codes. */
export class InMemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** Latest 6-digit code sent to `to`. */
  lastCode(to: string): string {
    const message = [...this.sent].reverse().find((m) => m.to === to);
    const code = message?.subject.match(/\d{6}/)?.[0];
    if (!code) throw new Error(`No code emailed to ${to}`);
    return code;
  }
}

export type TestApp = NestExpressApplication & { email: InMemoryEmailSender };

export async function createTestApp(
  env: Record<string, string> = {},
  extra: Pick<ModuleMetadata, 'controllers' | 'providers'> = {},
): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CORS_ORIGINS: TEST_ORIGIN,
    APP_BASE_URL: TEST_ORIGIN,
    // Prisma connects lazily: tests that never query do not need a running DB.
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_ACCESS_SECRET: 'test-jwt-access-secret-0123456789abcdef',
    AUTH_HMAC_SECRET: 'test-auth-hmac-secret-0123456789abcdef',
    THROTTLE_ENABLED: 'false',
    // Background schedulers are exercised directly in tests, not via Redis.
    WORKER_ENABLED: 'false',
    ...env,
  });

  const email = new InMemoryEmailSender();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config)],
    controllers: extra.controllers ?? [],
    providers: extra.providers ?? [],
  })
    .overrideProvider(EMAIL_SENDER)
    .useValue(email)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, config);
  await app.init();
  return Object.assign(app, { email });
}
