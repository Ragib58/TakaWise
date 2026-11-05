import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { VerificationPurpose } from '../../generated/prisma/enums';
import { generateOtp, hmacHex, safeEqual } from './crypto/secure-tokens';

/** One-time code rules (AUTH-02, AUTH-04). */
export const VERIFICATION_RULES = {
  EMAIL_VERIFY: { ttlMinutes: 10 },
  PASSWORD_RESET: { ttlMinutes: 15 },
  maxAttempts: 5,
  resendCooldownSeconds: 60,
} as const;

export type IssueResult = { issued: true; code: string } | { issued: false; reason: 'cooldown' };

/**
 * Expiring, single-use, attempt-limited numeric codes. Only an HMAC of the code
 * is stored. Issuing a new code supersedes any previous unused one.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private hash(userId: string, purpose: VerificationPurpose, code: string): string {
    return hmacHex(this.config.AUTH_HMAC_SECRET, `otp:${purpose}`, `${userId}:${code}`);
  }

  async issue(userId: string, purpose: VerificationPurpose): Promise<IssueResult> {
    const latest = await this.prisma.verificationToken.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const cooldownMs = VERIFICATION_RULES.resendCooldownSeconds * 1000;
    if (latest && Date.now() - latest.createdAt.getTime() < cooldownMs) {
      return { issued: false, reason: 'cooldown' };
    }

    const code = generateOtp();
    const now = new Date();
    await this.prisma.$transaction([
      // Supersede earlier codes so only the newest one works.
      this.prisma.verificationToken.updateMany({
        where: { userId, purpose, consumedAt: null },
        data: { consumedAt: now },
      }),
      this.prisma.verificationToken.create({
        data: {
          userId,
          purpose,
          codeHash: this.hash(userId, purpose, code),
          expiresAt: new Date(now.getTime() + VERIFICATION_RULES[purpose].ttlMinutes * 60_000),
        },
      }),
    ]);
    return { issued: true, code };
  }

  /**
   * True only for the newest, unexpired, unused code with attempts left. A wrong
   * guess burns an attempt; after `maxAttempts` the code is dead.
   *
   * Deliberately runs in its own statements (never inside a caller's transaction):
   * a failed attempt must be committed even if the caller later rolls back,
   * otherwise the attempt limit could be bypassed.
   */
  async consume(userId: string, purpose: VerificationPurpose, code: string): Promise<boolean> {
    const db = this.prisma;
    const token = await db.verificationToken.findFirst({
      where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!token || token.attempts >= VERIFICATION_RULES.maxAttempts) return false;

    if (!safeEqual(token.codeHash, this.hash(userId, purpose, code))) {
      await db.verificationToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }

    // Conditional update makes the code single-use even under concurrent requests.
    const { count } = await db.verificationToken.updateMany({
      where: {
        id: token.id,
        consumedAt: null,
        attempts: { lt: VERIFICATION_RULES.maxAttempts },
      },
      data: { consumedAt: new Date() },
    });
    return count === 1;
  }
}
