import { z } from 'zod';
import { currencyCodeSchema } from './money';

/**
 * Auth & profile contracts (Phase 3, ADR-011). Request bodies use strict
 * objects: unknown keys (e.g. a client-supplied `userId`) are rejected.
 */

export const ACCESS_TOKEN_HEADER = 'authorization';
export const CSRF_HEADER = 'x-csrf-token';
export const REFRESH_COOKIE = 'tw_rt';
export const CSRF_COOKIE = 'tw_csrf';

export const PASSWORD_MIN_LENGTH = 8;
/** Upper bound protects the server from hashing huge inputs. */
export const PASSWORD_MAX_LENGTH = 128;
export const OTP_LENGTH = 6;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254));

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

/** Login accepts any stored password length; policy applies only when setting one. */
export const currentPasswordSchema = z
  .string()
  .min(1, 'Enter your password')
  .max(PASSWORD_MAX_LENGTH);

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`);

export const fullNameSchema = z.string().trim().min(1, 'Enter your name').max(120);

export const LOCALES = ['en', 'bn'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, 'Must be a valid IANA time zone, e.g. Asia/Dhaka');

// ─────────────────────────── Requests ───────────────────────────

export const registerRequestSchema = z.strictObject({
  fullName: fullNameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  locale: localeSchema.default('en'),
  acceptTerms: z.literal(true, 'You must accept the terms to continue'),
});
export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const verifyEmailRequestSchema = z.strictObject({
  email: emailSchema,
  code: otpCodeSchema,
});
export type VerifyEmailRequest = z.input<typeof verifyEmailRequestSchema>;

export const emailOnlyRequestSchema = z.strictObject({ email: emailSchema });
export type EmailOnlyRequest = z.input<typeof emailOnlyRequestSchema>;

export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: currentPasswordSchema,
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const resetPasswordRequestSchema = z.strictObject({
  email: emailSchema,
  code: otpCodeSchema,
  newPassword: newPasswordSchema,
});
export type ResetPasswordRequest = z.input<typeof resetPasswordRequestSchema>;

export const changePasswordRequestSchema = z.strictObject({
  currentPassword: currentPasswordSchema,
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.input<typeof changePasswordRequestSchema>;

export const updateMeRequestSchema = z
  .strictObject({
    fullName: fullNameSchema.optional(),
    locale: localeSchema.optional(),
    timezone: timeZoneSchema.optional(),
    defaultCurrency: currencyCodeSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Provide at least one field');
export type UpdateMeRequest = z.input<typeof updateMeRequestSchema>;

// ─────────────────────────── Responses ──────────────────────────

export const meResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  profile: z.object({
    fullName: z.string(),
    locale: localeSchema,
    timezone: z.string(),
    defaultCurrency: z.string(),
  }),
  createdAt: z.iso.datetime(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const authSessionResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  user: meResponseSchema,
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

/** Deliberately identical whether or not the email exists (no account enumeration). */
export const acceptedResponseSchema = z.object({
  status: z.enum(['verification_required', 'email_sent', 'password_reset', 'logged_out', 'ok']),
});
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;

export const sessionSummarySchema = z.object({
  id: z.string(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
