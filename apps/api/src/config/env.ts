import { z } from 'zod';

/**
 * Environment contract for the API. Parsed once at boot; the process refuses to
 * start on invalid configuration (fail fast, never run with unsafe defaults).
 *
 * Variables for later phases (REDIS_URL, JWT_*, EMAIL_*, OBJECT_STORAGE_*) become
 * required in the phase that first uses them.
 */

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const originSchema = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
    } catch {
      return false;
    }
  },
  { message: 'must be a bare origin like https://app.example.com (no path or trailing slash)' },
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_BASE_URL: z.url().default('http://localhost:3100'),
    APP_VERSION: z.string().min(1).default('0.1.0'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3100')
      .transform((raw) =>
        raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .pipe(z.array(originSchema).min(1, 'at least one origin is required')),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Max JSON body size accepted by the API. */
    BODY_LIMIT: z.string().default('100kb'),
    /** PostgreSQL connection string (required from Phase 2). */
    DATABASE_URL: z
      .string()
      .regex(/^postgres(?:ql)?:\/\/.+/, 'must be a postgres:// or postgresql:// URL'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z.string().min(1).optional(),
    /** ADR-017: print OTPs to the console. Development only — rejected otherwise. */
    DEV_LOG_OTP: booleanFlag,
  })
  .superRefine((env, ctx) => {
    if (env.DEV_LOG_OTP && env.NODE_ENV !== 'development') {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_LOG_OTP'],
        message: 'DEV_LOG_OTP may only be enabled when NODE_ENV=development',
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema> & {
  readonly isProduction: boolean;
  readonly swaggerEnabled: boolean;
};

export class InvalidConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'InvalidConfigError';
  }
}

export function loadConfig(raw: NodeJS.ProcessEnv | Record<string, string | undefined>): AppConfig {
  const issues: string[] = [];

  // Production must never fall back to development defaults for security-relevant values.
  if (raw.NODE_ENV === 'production') {
    for (const key of ['CORS_ORIGINS', 'APP_BASE_URL'] as const) {
      if (!raw[key]) issues.push(`${key}: must be set explicitly in production`);
    }
  }

  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push(`${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  }

  if (issues.length > 0 || !parsed.success) {
    throw new InvalidConfigError(issues);
  }

  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';
  return Object.freeze({
    ...env,
    isProduction,
    swaggerEnabled: !isProduction,
  });
}
