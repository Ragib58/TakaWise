import { InvalidConfigError, loadConfig } from './env';

const prodBase = {
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://app.takawise.example',
  APP_BASE_URL: 'https://app.takawise.example',
};

describe('loadConfig', () => {
  it('applies safe development defaults', () => {
    const config = loadConfig({});
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(4000);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:3100']);
    expect(config.DEV_LOG_OTP).toBe(false);
    expect(config.swaggerEnabled).toBe(true);
    expect(config.isProduction).toBe(false);
  });

  it('parses a comma-separated CORS allowlist', () => {
    const config = loadConfig({ CORS_ORIGINS: 'http://localhost:3100, https://app.example.com' });
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:3100', 'https://app.example.com']);
  });

  it.each(['https://app.example.com/', 'https://app.example.com/path', '*', 'ftp://x.example.com'])(
    'rejects non-origin CORS entry %s',
    (origin) => {
      expect(() => loadConfig({ CORS_ORIGINS: origin })).toThrow(InvalidConfigError);
    },
  );

  it('disables Swagger in production', () => {
    const config = loadConfig(prodBase);
    expect(config.swaggerEnabled).toBe(false);
    expect(config.isProduction).toBe(true);
  });

  it('requires explicit CORS_ORIGINS and APP_BASE_URL in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS.*\n.*APP_BASE_URL/s);
  });

  describe('DEV_LOG_OTP (ADR-017)', () => {
    it('is allowed in development', () => {
      expect(loadConfig({ NODE_ENV: 'development', DEV_LOG_OTP: 'true' }).DEV_LOG_OTP).toBe(true);
    });

    it.each(['production', 'test'])('is rejected when NODE_ENV=%s', (env) => {
      const raw =
        env === 'production'
          ? { ...prodBase, DEV_LOG_OTP: 'true' }
          : { NODE_ENV: env, DEV_LOG_OTP: 'true' };
      expect(() => loadConfig(raw)).toThrow(/DEV_LOG_OTP/);
    });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow(InvalidConfigError);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });
});
