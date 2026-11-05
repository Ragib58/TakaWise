import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  isValidTimeZone,
  loginRequestSchema,
  registerRequestSchema,
  updateMeRequestSchema,
  verifyEmailRequestSchema,
} from './auth';

describe('emailSchema', () => {
  it('normalises case and whitespace', () => {
    expect(emailSchema.parse('  Rahim.Uddin@Example.COM ')).toBe('rahim.uddin@example.com');
  });

  it('rejects invalid addresses', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('registerRequestSchema', () => {
  const valid = {
    fullName: 'Rahim Uddin',
    email: 'rahim@example.com',
    password: 'correct horse battery',
    acceptTerms: true,
  };

  it('accepts a valid request and defaults locale to en', () => {
    expect(registerRequestSchema.parse(valid).locale).toBe('en');
  });

  it('requires accepting the terms', () => {
    expect(registerRequestSchema.safeParse({ ...valid, acceptTerms: false }).success).toBe(false);
  });

  it('rejects short passwords', () => {
    expect(registerRequestSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
  });

  it('rejects unknown keys such as a client-supplied userId', () => {
    expect(registerRequestSchema.safeParse({ ...valid, userId: 'x' }).success).toBe(false);
  });
});

describe('other auth requests', () => {
  it('requires a 6-digit OTP', () => {
    expect(verifyEmailRequestSchema.safeParse({ email: 'a@b.co', code: '12345' }).success).toBe(
      false,
    );
    expect(verifyEmailRequestSchema.safeParse({ email: 'a@b.co', code: '123456' }).success).toBe(
      true,
    );
  });

  it('login does not apply the new-password policy', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });

  it('updateMe needs at least one field and a valid time zone', () => {
    expect(updateMeRequestSchema.safeParse({}).success).toBe(false);
    expect(updateMeRequestSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(updateMeRequestSchema.safeParse({ timezone: 'Asia/Dhaka' }).success).toBe(true);
  });

  it('validates IANA time zones', () => {
    expect(isValidTimeZone('Asia/Dhaka')).toBe(true);
    expect(isValidTimeZone('Nowhere/Town')).toBe(false);
  });
});
