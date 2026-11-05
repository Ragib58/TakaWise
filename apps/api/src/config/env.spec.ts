import { InvalidConfigError, loadConfig } from './env';

const required = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5442/takawise',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  AUTH_HMAC_SECRET: 'b'.repeat(40),
};

const load = (raw: Record<string, string> = {}) => loadConfig({ ...required, ...raw });

const prodBase = {
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://app.takawise.example',
  APP_BASE_URL: 'https://app.takawise.example',
  SMTP_URL: 'smtps://relay.example.com:465',
};

describe('loadConfig', () => {
  it('applies safe development defaults', () => {
    const config = load();
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(4000);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:3100']);
    expect(config.DATABASE_POOL_MAX).toBe(10);
    expect(config.DEV_LOG_OTP).toBe(false);
    expect(config.swaggerEnabled).toBe(true);
    expect(config.isProduction).toBe(false);
  });

  it('requires DATABASE_URL and the auth secrets', () => {
    expect(() => loadConfig({})).toThrow(
      /DATABASE_URL[\s\S]*JWT_ACCESS_SECRET[\s\S]*AUTH_HMAC_SECRET/,
    );
  });

  it.each(['mysql://localhost/db', 'localhost:5432', ''])('rejects DATABASE_URL %p', (url) => {
    expect(() => load({ DATABASE_URL: url })).toThrow(/DATABASE_URL/);
  });

  describe('auth secrets and cookies (ADR-011)', () => {
    it('rejects short secrets', () => {
      expect(() => load({ JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET.*32/);
    });

    it('rejects reusing the JWT secret as the HMAC secret', () => {
      expect(() => load({ AUTH_HMAC_SECRET: required.JWT_ACCESS_SECRET })).toThrow(
        /AUTH_HMAC_SECRET: must differ/,
      );
    });

    it('rejects placeholder secrets in production', () => {
      expect(() =>
        load({ ...prodBase, JWT_ACCESS_SECRET: 'change-me-please-0123456789abcdefghij' }),
      ).toThrow(/placeholder/);
    });

    it('uses Secure cookies in production and refuses to disable them', () => {
      expect(load(prodBase).cookieSecure).toBe(true);
      expect(() => load({ ...prodBase, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    });

    it('defaults to non-Secure cookies on plain-http localhost in development', () => {
      expect(load().cookieSecure).toBe(false);
    });

    it('requires SMTP_URL in production', () => {
      const { SMTP_URL: _smtp, ...withoutSmtp } = prodBase;
      expect(() => load(withoutSmtp)).toThrow(/SMTP_URL: required in production/);
    });

    it('enables rate limiting by default', () => {
      expect(load().THROTTLE_ENABLED).toBe(true);
    });
  });

  it('parses a comma-separated CORS allowlist', () => {
    const config = load({ CORS_ORIGINS: 'http://localhost:3100, https://app.example.com' });
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:3100', 'https://app.example.com']);
  });

  it.each(['https://app.example.com/', 'https://app.example.com/path', '*', 'ftp://x.example.com'])(
    'rejects non-origin CORS entry %s',
    (origin) => {
      expect(() => load({ CORS_ORIGINS: origin })).toThrow(InvalidConfigError);
    },
  );

  it('disables Swagger in production', () => {
    const config = load(prodBase);
    expect(config.swaggerEnabled).toBe(false);
    expect(config.isProduction).toBe(true);
  });

  it('requires explicit CORS_ORIGINS and APP_BASE_URL in production', () => {
    expect(() => load({ NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS.*\n.*APP_BASE_URL/s);
  });

  describe('DEV_LOG_OTP (ADR-017)', () => {
    it('is allowed in development', () => {
      expect(load({ NODE_ENV: 'development', DEV_LOG_OTP: 'true' }).DEV_LOG_OTP).toBe(true);
    });

    it.each(['production', 'test'])('is rejected when NODE_ENV=%s', (env) => {
      const raw =
        env === 'production'
          ? { ...prodBase, DEV_LOG_OTP: 'true' }
          : { NODE_ENV: env, DEV_LOG_OTP: 'true' };
      expect(() => load(raw)).toThrow(/DEV_LOG_OTP/);
    });
  });

  it('rejects an invalid port', () => {
    expect(() => load({ PORT: '70000' })).toThrow(InvalidConfigError);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(load())).toBe(true);
  });
});
