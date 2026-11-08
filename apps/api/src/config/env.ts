import { z } from 'zod';

/**
 * Environment contract for the API. Parsed once at boot; the process refuses to
 * start on invalid configuration (fail fast, never run with unsafe defaults).
 *
 * Variables for later phases (REDIS_URL, OBJECT_STORAGE_*) become required in the
 * phase that first uses them.
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

const secretSchema = z.string().min(32, 'must be at least 32 characters of random data');

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
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\/.+/, 'must be a redis:// or rediss:// URL')
      .optional(),
    /** Redis key prefix for BullMQ, so environments sharing a Redis never mix jobs. */
    JOBS_PREFIX: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .default('takawise'),
    /** Run BullMQ schedulers/workers in this process (ADR-014). Needs REDIS_URL. */
    WORKER_ENABLED: z
      .enum(['true', 'false', '1', '0'])
      .default('true')
      .transform((v) => v === 'true' || v === '1'),
    /** ADR-017: print OTPs to the console. Development only — rejected otherwise. */
    DEV_LOG_OTP: booleanFlag,

    // ── Auth (Phase 3, ADR-011) ──
    /** HS256 signing key for access tokens. */
    JWT_ACCESS_SECRET: secretSchema,
    /**
     * Previous signing key, accepted for VERIFICATION only during a rotation
     * window (≥ access-token TTL). See docs/runbooks/secret-rotation.md.
     */
    JWT_ACCESS_SECRET_PREVIOUS: secretSchema.optional(),
    /** Bearer token for GET /metrics. Unset → metrics disabled in production. */
    METRICS_TOKEN: secretSchema.optional(),
    /** HMAC key for OTP codes and IP pseudonymisation (never the same as the JWT key). */
    AUTH_HMAC_SECRET: secretSchema,
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** Defaults to true in production; may only be disabled outside production. */
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    /** Parent domain for the CSRF cookie when web and API are on sibling subdomains. */
    COOKIE_DOMAIN: z.string().min(1).optional(),
    /** Number of trusted reverse-proxy hops (Express "trust proxy"). */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    /** Request rate limiting (disable only in tests). */
    THROTTLE_ENABLED: z
      .enum(['true', 'false', '1', '0'])
      .default('true')
      .transform((v) => v === 'true' || v === '1'),

    // ── Email ──
    /** e.g. smtp://localhost:1035 (Mailpit) or an SMTP relay URL. Required in production. */
    SMTP_URL: z
      .string()
      .regex(/^smtps?:\/\/.+/, 'must be an smtp:// or smtps:// URL')
      .optional(),
    EMAIL_FROM: z.string().min(3).default('TakaWise <no-reply@takawise.local>'),

    // ── Opt-in AI and OCR (Phase 9, ADR-024) ──
    /** Master switch. Off by default; nothing is ever sent to a provider while false. */
    AI_ENABLED: booleanFlag,
    /** `fake` is a deterministic offline provider for development and tests only. */
    AI_PROVIDER: z.enum(['none', 'anthropic', 'fake']).default('none'),
    /** Secret API key for the provider (blueprint §12). Never exposed to the browser. */
    AI_PROVIDER_API_KEY: z.string().min(20).optional(),
    AI_MODEL: z
      .string()
      .regex(/^[a-z0-9.-]{3,64}$/)
      .default('claude-opus-5-5'),
    /** Comma-separated feature flags; anything not listed is off. */
    AI_FEATURES: z
      .string()
      .default('MONTHLY_SUMMARY,UNUSUAL_SPENDING,SAVINGS_SUGGESTIONS,TRANSACTION_DRAFT,RECEIPT_OCR')
      .transform((raw) =>
        raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .pipe(
        z.array(
          z.enum([
            'MONTHLY_SUMMARY',
            'UNUSUAL_SPENDING',
            'SAVINGS_SUGGESTIONS',
            'TRANSACTION_DRAFT',
            'RECEIPT_OCR',
          ]),
        ),
      ),
    /** Provider calls per user per rolling 24 h (cached insights do not count). */
    AI_USER_DAILY_REQUESTS: z.coerce.number().int().min(1).max(1000).default(30),
    /** Input + output tokens per user per calendar month (UTC). */
    AI_USER_MONTHLY_TOKENS: z.coerce.number().int().min(1000).default(300_000),
    /** Cost circuit breaker across all users per UTC day. */
    AI_GLOBAL_DAILY_TOKENS: z.coerce.number().int().min(1000).default(5_000_000),
    AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(60_000),
    /** Receipt upload limit; the provider accepts images up to 5 MB. */
    OCR_MAX_BYTES: z.coerce.number().int().min(100_000).max(5_000_000).default(4_000_000),

    // ── Subscriptions & family (Phase 10, ADR-025/026) ──
    /**
     * `none` until a payment provider is approved and integrated; `fake` is a
     * signed, offline stand-in for development and tests (rejected in production).
     */
    PAYMENT_PROVIDER: z.enum(['none', 'fake']).default('none'),
    /** Webhook signing secret shared with the provider (blueprint §12 PAYMENT_PROVIDER_SECRET). */
    PAYMENT_PROVIDER_SECRET: secretSchema.optional(),
    CHECKOUT_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    FAMILY_INVITE_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.COOKIE_SECURE === 'false') {
        ctx.addIssue({
          code: 'custom',
          path: ['COOKIE_SECURE'],
          message: 'cookies must be Secure in production',
        });
      }
      if (!env.SMTP_URL) {
        ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'required in production' });
      }
      if (env.WORKER_ENABLED && !env.REDIS_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['REDIS_URL'],
          message: 'required in production when WORKER_ENABLED=true',
        });
      }
      for (const key of ['JWT_ACCESS_SECRET', 'AUTH_HMAC_SECRET'] as const) {
        if (/change-?me|placeholder|not-a-secret/i.test(env[key])) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'looks like a placeholder; use a random secret',
          });
        }
      }
    }
    if (env.JWT_ACCESS_SECRET === env.AUTH_HMAC_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_HMAC_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      });
    }
    if (env.AI_PROVIDER === 'fake' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'the fake AI provider is not allowed in production',
      });
    }
    if (env.AI_PROVIDER === 'anthropic' && !env.AI_PROVIDER_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER_API_KEY'],
        message: 'required when AI_PROVIDER=anthropic',
      });
    }
    if (env.AI_ENABLED && env.AI_PROVIDER === 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'choose a provider when AI_ENABLED=true',
      });
    }
    if (env.PAYMENT_PROVIDER === 'fake' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'the fake payment provider is not allowed in production',
      });
    }
    if (env.PAYMENT_PROVIDER !== 'none' && !env.PAYMENT_PROVIDER_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER_SECRET'],
        message: 'required when PAYMENT_PROVIDER is set',
      });
    }
    if (env.DEV_LOG_OTP && env.NODE_ENV !== 'development') {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_LOG_OTP'],
        message: 'DEV_LOG_OTP may only be enabled when NODE_ENV=development',
      });
    }
  });

export type AppConfig = Omit<z.infer<typeof envSchema>, 'COOKIE_SECURE'> & {
  readonly isProduction: boolean;
  readonly swaggerEnabled: boolean;
  readonly cookieSecure: boolean;
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

  const { COOKIE_SECURE, ...env } = parsed.data;
  const isProduction = env.NODE_ENV === 'production';
  return Object.freeze({
    ...env,
    isProduction,
    swaggerEnabled: !isProduction,
    cookieSecure: COOKIE_SECURE === undefined ? isProduction : COOKIE_SECURE === 'true',
  });
}
