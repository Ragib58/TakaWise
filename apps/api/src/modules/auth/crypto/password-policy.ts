import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@takawise/contracts';

/**
 * NIST SP 800-63B style policy: length over composition rules, and block the
 * most common / context-specific passwords. No forced symbol/upper-case rules.
 */
const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '123123123',
  '11111111',
  '00000000',
  '12341234',
  '87654321',
  '88888888',
  '99999999',
  '11223344',
  '12344321',
  '147258369',
  '123456123',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'p@ssw0rd',
  'p@ssword',
  'qwerty123',
  'qwertyuiop',
  'qwerty12',
  'asdfghjkl',
  'zxcvbnm1',
  '1q2w3e4r',
  '1qaz2wsx',
  'abcd1234',
  'abc12345',
  'iloveyou',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'welcome1',
  'welcome123',
  'letmein1',
  'trustno1',
  'superman',
  'starwars',
  'whatever',
  'computer',
  'internet',
  'admin123',
  'administrator',
  'changeme',
  'default1',
  'monkey123',
  'dragon12',
  'bangladesh',
  'bangladesh1',
  'bangladesh123',
  'dhaka123',
  'dhaka1234',
  'bangla123',
  'takawise',
  'takawise1',
  'takawise123',
  'bkash123',
  'nagad123',
  'allah123',
  'bismillah',
]);

export type PasswordPolicyContext = { email?: string; fullName?: string };

/** Returns a user-facing reason when the password is unacceptable, otherwise null. */
export function passwordPolicyViolation(
  password: string,
  context: PasswordPolicyContext = {},
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;

  const normalized = password.toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) return 'This password is too common. Choose another one.';
  if (/^(.)\1+$/.test(password)) return 'Do not use a single repeated character.';

  const emailLocal = context.email?.split('@')[0]?.toLowerCase();
  if (emailLocal && emailLocal.length >= 4 && normalized.includes(emailLocal)) {
    return 'Do not include your email address in your password.';
  }
  const name = context.fullName?.replace(/\s+/g, '').toLowerCase();
  if (name && name.length >= 4 && normalized.includes(name)) {
    return 'Do not include your name in your password.';
  }
  return null;
}
