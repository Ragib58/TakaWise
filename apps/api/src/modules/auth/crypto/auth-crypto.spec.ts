import { PasswordHasher } from './password-hasher.service';
import { passwordPolicyViolation } from './password-policy';
import { generateOtp, generateRefreshToken, hmacHex, safeEqual, sha256Hex } from './secure-tokens';

describe('secure tokens', () => {
  it('generates 6-digit, zero-padded OTPs', () => {
    for (let i = 0; i < 500; i += 1) expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it('generates unique 256-bit refresh tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateRefreshToken));
    expect(tokens.size).toBe(100);
    expect(Buffer.from([...tokens][0]!, 'base64url')).toHaveLength(32);
  });

  it('hashes deterministically and separates purposes', () => {
    expect(sha256Hex('abc')).toHaveLength(64);
    expect(hmacHex('k'.repeat(32), 'otp', '123456')).toBe(hmacHex('k'.repeat(32), 'otp', '123456'));
    expect(hmacHex('k'.repeat(32), 'otp', '123456')).not.toBe(
      hmacHex('k'.repeat(32), 'ip', '123456'),
    );
    expect(hmacHex('k'.repeat(32), 'otp', '123456')).not.toBe(
      hmacHex('j'.repeat(32), 'otp', '123456'),
    );
  });

  it('compares safely, including different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('password policy', () => {
  it('accepts a long passphrase', () => {
    expect(passwordPolicyViolation('amar sonar bangla 1971')).toBeNull();
  });

  it.each(['password123', 'Bangladesh123', '12345678', 'aaaaaaaaaa'])('rejects %p', (pw) => {
    expect(passwordPolicyViolation(pw)).not.toBeNull();
  });

  it('rejects passwords containing the email local part or name', () => {
    expect(passwordPolicyViolation('rahimuddin!2026', { email: 'rahimuddin@example.com' })).toMatch(
      /email/,
    );
    expect(passwordPolicyViolation('my-RahimUddin-pw', { fullName: 'Rahim Uddin' })).toMatch(
      /name/,
    );
  });
});

describe('PasswordHasher (Argon2id)', () => {
  const hasher = new PasswordHasher();

  it('hashes with argon2id and verifies', async () => {
    const hash = await hasher.hash('amar sonar bangla');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(hasher.verify(hash, 'amar sonar bangla')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'wrong')).resolves.toBe(false);
  });

  it('returns false for malformed hashes instead of throwing', async () => {
    await expect(hasher.verify('not-a-hash', 'x')).resolves.toBe(false);
  });

  it('verifyAgainstDummy always fails', async () => {
    await expect(hasher.verifyAgainstDummy('anything')).resolves.toBe(false);
  });
});
