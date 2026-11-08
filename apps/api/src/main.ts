import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import { InvalidConfigError, loadConfig } from './config/env';

function loadDotEnv(): void {
  // Local development convenience only; real environments inject variables.
  const file = resolve(process.cwd(), '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

async function bootstrap(): Promise<void> {
  loadDotEnv();
  const config = loadConfig(process.env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    bufferLogs: true,
    // Raw bytes for webhook signature verification (ADR-025).
    rawBody: true,
  });
  configureApp(app, config);

  await app.listen(config.PORT);
}

bootstrap().catch((error: unknown) => {
  if (error instanceof InvalidConfigError) {
    console.error(error.message);
  } else {
    console.error('Fatal error during API bootstrap', error);
  }
  process.exit(1);
});
