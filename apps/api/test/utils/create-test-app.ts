import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import { loadConfig } from '../../src/config/env';

export const TEST_ORIGIN = 'http://localhost:3100';

export async function createTestApp(
  env: Record<string, string> = {},
  extra: Pick<ModuleMetadata, 'controllers' | 'providers'> = {},
): Promise<NestExpressApplication> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CORS_ORIGINS: TEST_ORIGIN,
    APP_BASE_URL: TEST_ORIGIN,
    ...env,
  });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config)],
    controllers: extra.controllers ?? [],
    providers: extra.providers ?? [],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, config);
  await app.init();
  return app;
}
