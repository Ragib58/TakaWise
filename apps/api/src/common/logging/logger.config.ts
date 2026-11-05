import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../../config/env';
import { resolveRequestId } from '../request-id';

/**
 * Paths censored anywhere they appear in a log line. Request/response bodies are
 * never logged by pino-http; this protects explicit `logger.x({ ... })` calls too.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.otp',
  '*.otpCode',
  '*.verificationCode',
  '*.description',
  '*.notes',
];

export function buildLoggerParams(config: AppConfig): Params {
  const pretty = config.NODE_ENV === 'development';
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      genReqId: resolveRequestId,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      // Log only what we need: no headers, no query string (may hold tokens).
      serializers: {
        req: (req: IncomingMessage & { id?: unknown }) => ({
          id: req.id,
          method: req.method,
          url: (req.url ?? '').split('?')[0],
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: {
        ignore: (req) => (req.url ?? '').startsWith('/api/v1/health'),
      },
      ...(pretty
        ? { transport: { target: 'pino-pretty', options: { singleLine: true, colorize: true } } }
        : {}),
    },
  };
}
