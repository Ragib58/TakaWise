import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_PREFIX } from '@takawise/contracts';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import type { AppConfig } from '../config/env';

export const SWAGGER_PATH = 'api/docs';

export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Idempotency-Key',
  'X-Request-Id',
  'X-CSRF-Token',
];

/**
 * Applies all HTTP-level concerns. Shared by main.ts and the e2e tests so tests
 * exercise exactly the production pipeline.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));
  app.flushLogs();

  app.disable('x-powered-by');
  app.setGlobalPrefix(API_PREFIX);
  app.useBodyParser('json', { limit: config.BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: config.BODY_LIMIT, extended: false });

  // Swagger UI needs inline assets; strict CSP applies wherever Swagger is off.
  app.use(helmet({ contentSecurityPolicy: config.swaggerEnabled ? false : undefined }));

  const allowed = new Set(config.CORS_ORIGINS);
  app.enableCors({
    origin: (origin, callback) => {
      // No Origin header = same-origin or non-browser client; CORS does not apply.
      callback(null, !origin || allowed.has(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: CORS_ALLOWED_HEADERS,
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  app.enableShutdownHooks();

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('TakaWise API')
        .setDescription('TakaWise personal finance REST API')
        .setVersion(config.APP_VERSION)
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(SWAGGER_PATH, app, cleanupOpenApiDoc(document), {
      jsonDocumentUrl: `${SWAGGER_PATH}-json`,
    });
  }
}
