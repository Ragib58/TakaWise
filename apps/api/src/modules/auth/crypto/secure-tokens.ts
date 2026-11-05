import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { OTP_LENGTH } from '@takawise/contracts';

/** 256-bit opaque refresh token (base64url). Only its SHA-256 is stored. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** CSRF double-submit token (ADR-011). */
export function generateCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Uniformly random numeric one-time code, e.g. "042917". */
export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');
}

/**
 * SHA-256 is sufficient for high-entropy tokens (refresh tokens): they cannot be
 * brute-forced, so no secret is needed.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Keyed hash for low-entropy values (6-digit OTPs, IP addresses). Without the
 * key, a leaked hash cannot be reversed by enumerating the small input space.
 * `purpose` gives domain separation so hashes cannot be reused across contexts.
 */
export function hmacHex(secret: string, purpose: string, value: string): string {
  return createHmac('sha256', secret).update(`${purpose}\u0000${value}`, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex/ASCII strings. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
