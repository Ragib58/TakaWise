import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AuthSessionResponse,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  VerifyEmailRequest,
} from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import type { ClientContext } from '../../common/http/client-context';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { VerificationPurpose } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { renderEmail } from '../email/email-templates';
import { EMAIL_SENDER, type EmailSender } from '../email/email.types';
import { toApiLocale, toMeResponse } from '../users/user.mapper';
import { UserProvisioningService } from '../users/user-provisioning.service';
import { AccessTokenService } from './access-token.service';
import { PasswordHasher } from './crypto/password-hasher.service';
import { passwordPolicyViolation } from './crypto/password-policy';
import { generateCsrfToken } from './crypto/secure-tokens';
import { SessionsService } from './sessions.service';
import { VerificationService } from './verification.service';

/** Everything the controller needs to answer and to set cookies. */
export type SignedInSession = {
  body: AuthSessionResponse;
  refreshToken: string;
  csrfToken: string;
};

type RegisterInput = Omit<RegisterRequest, 'locale'> & { locale: 'en' | 'bn' };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionsService,
    private readonly verification: VerificationService,
    private readonly accessTokens: AccessTokenService,
    private readonly provisioning: UserProvisioningService,
    private readonly audit: AuditService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ───────────────────────────── Registration ─────────────────────────────

  /**
   * Always answers the same way so the endpoint cannot be used to discover which
   * emails are registered (the password is hashed on every path for timing parity).
   */
  async register(input: RegisterInput, client: ClientContext): Promise<void> {
    const violation = passwordPolicyViolation(input.password, {
      email: input.email,
      fullName: input.fullName,
    });
    if (violation) throw new AppException('WEAK_PASSWORD', violation, HttpStatus.BAD_REQUEST);

    const passwordHash = await this.hasher.hash(input.password);
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { profile: true },
    });

    if (existing) {
      if (existing.status === 'PENDING_VERIFICATION') {
        await this.sendCode(existing.id, existing.email, 'EMAIL_VERIFY', client);
      } else {
        await this.sendNotice(
          existing.email,
          existing.profile?.fullName ?? '',
          toApiLocale(existing.profile?.locale ?? 'EN'),
        );
        await this.audit.recordSafely(
          { action: 'auth.register.existing_email', userId: existing.id },
          client,
        );
      }
      return;
    }

    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const user = await this.provisioning.createUser(tx, {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          locale: input.locale,
        });
        await this.audit.record(
          { action: 'auth.register', userId: user.id, metadata: { locale: input.locale } },
          client,
          tx,
        );
        return user.id;
      });
    } catch (error) {
      // A concurrent registration for the same email won the race: answer identically.
      if ((error as { code?: string }).code === 'P2002') return;
      throw error;
    }

    await this.sendCode(userId, input.email, 'EMAIL_VERIFY', client);
  }

  async resendVerification(email: string, client: ClientContext): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.status === 'PENDING_VERIFICATION') {
      await this.sendCode(user.id, user.email, 'EMAIL_VERIFY', client);
    }
  }

  /** Verifies the email and signs the user in. */
  async verifyEmail(input: VerifyEmailRequest, client: ClientContext): Promise<SignedInSession> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const valid =
      user?.status === 'PENDING_VERIFICATION' &&
      (await this.verification.consume(user.id, 'EMAIL_VERIFY', input.code));
    if (!user || !valid) throw invalidCode();

    const session = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
      await this.audit.record({ action: 'auth.email_verified', userId: user.id }, client, tx);
      return this.sessions.create(user.id, client, tx);
    });
    return this.signedIn(user.id, session);
  }

  // ──────────────────────────────── Login ────────────────────────────────

  async login(input: LoginRequest, client: ClientContext): Promise<SignedInSession> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const passwordOk = user
      ? await this.hasher.verify(user.passwordHash, input.password)
      : await this.hasher.verifyAgainstDummy(input.password);

    if (!user || !passwordOk) {
      await this.audit.recordSafely(
        {
          action: 'auth.login.failed',
          userId: user?.id ?? null,
          metadata: { reason: 'credentials' },
        },
        client,
      );
      throw new AppException(
        'INVALID_CREDENTIALS',
        'Incorrect email or password.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    // Status is only revealed to someone who knows the password.
    if (user.status === 'PENDING_VERIFICATION') {
      throw new AppException(
        'EMAIL_NOT_VERIFIED',
        'Please verify your email address first.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (user.status !== 'ACTIVE') {
      await this.audit.recordSafely(
        { action: 'auth.login.failed', userId: user.id, metadata: { reason: user.status } },
        client,
      );
      throw new AppException(
        'ACCOUNT_DISABLED',
        'This account is not active. Please contact support.',
        HttpStatus.FORBIDDEN,
      );
    }

    const session = await this.sessions.create(user.id, client);
    await this.audit.recordSafely(
      {
        action: 'auth.login.succeeded',
        userId: user.id,
        entityType: 'session',
        entityId: session.sessionId,
      },
      client,
    );
    return this.signedIn(user.id, session);
  }

  async refresh(refreshToken: string | undefined, client: ClientContext): Promise<SignedInSession> {
    if (!refreshToken) throw sessionExpired();
    const rotated = await this.sessions.rotate(refreshToken, client);
    if (!rotated.ok) throw sessionExpired();

    const user = await this.prisma.user.findUnique({ where: { id: rotated.userId } });
    if (user?.status !== 'ACTIVE') {
      await this.sessions.revokeAllForUser(rotated.userId, 'REVOKED_BY_USER');
      throw sessionExpired();
    }
    return this.signedIn(user.id, rotated);
  }

  async logout(refreshToken: string | undefined, client: ClientContext): Promise<void> {
    if (!refreshToken) return;
    const userId = await this.sessions.revokeByRefreshToken(refreshToken, 'LOGOUT');
    if (userId) await this.audit.recordSafely({ action: 'auth.logout', userId }, client);
  }

  async logoutAll(userId: string, client: ClientContext): Promise<void> {
    const count = await this.sessions.revokeAllForUser(userId, 'LOGOUT_ALL');
    await this.audit.recordSafely(
      { action: 'auth.logout_all', userId, metadata: { sessions: count } },
      client,
    );
  }

  // ──────────────────────────── Password reset ────────────────────────────

  async forgotPassword(email: string, client: ClientContext): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.status !== 'ACTIVE') return;
    const sent = await this.sendCode(user.id, user.email, 'PASSWORD_RESET', client);
    if (sent)
      await this.audit.recordSafely(
        { action: 'auth.password_reset.requested', userId: user.id },
        client,
      );
  }

  /** Sets a new password and signs out every session (AUTH-03). */
  async resetPassword(input: ResetPasswordRequest, client: ClientContext): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { profile: true },
    });
    // Check the policy before consuming the code so a weak choice does not burn it.
    const violation = passwordPolicyViolation(input.newPassword, {
      email: input.email,
      fullName: user?.profile?.fullName,
    });
    if (violation) throw new AppException('WEAK_PASSWORD', violation, HttpStatus.BAD_REQUEST);

    const valid =
      user?.status === 'ACTIVE' &&
      (await this.verification.consume(user.id, 'PASSWORD_RESET', input.code));
    if (!user || !valid) throw invalidCode();

    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await this.sessions.revokeAllForUser(user.id, 'PASSWORD_RESET', { db: tx });
      await this.audit.record(
        { action: 'auth.password_reset.completed', userId: user.id },
        client,
        tx,
      );
    });
  }

  // ─────────────────────────────── Helpers ───────────────────────────────

  private async signedIn(
    userId: string,
    session: { sessionId: string; refreshToken: string },
  ): Promise<SignedInSession> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true },
    });
    const access = this.accessTokens.issue(userId, session.sessionId);
    return {
      body: {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
        user: toMeResponse(user),
      },
      refreshToken: session.refreshToken,
      csrfToken: generateCsrfToken(),
    };
  }

  /** Issues a code (respecting the resend cooldown) and emails it. */
  private async sendCode(
    userId: string,
    to: string,
    purpose: VerificationPurpose,
    client: ClientContext,
  ): Promise<boolean> {
    const result = await this.verification.issue(userId, purpose);
    if (!result.issued) return false;

    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    const locale = toApiLocale(profile?.locale ?? 'EN');
    const message = renderEmail(
      purpose === 'EMAIL_VERIFY' ? 'verifyEmail' : 'passwordReset',
      locale,
      {
        to,
        name: profile?.fullName ?? '',
        code: result.code,
        appUrl: this.config.APP_BASE_URL,
      },
    );

    if (this.config.DEV_LOG_OTP && this.config.NODE_ENV === 'development') {
      // ADR-017: development-only convenience; config validation forbids it elsewhere.
      this.logger.warn(`[DEV_LOG_OTP] ${purpose} code for ${to}: ${result.code}`);
    }
    await this.deliver(message);
    await this.audit.recordSafely(
      { action: 'auth.verification_code.sent', userId, metadata: { purpose } },
      client,
    );
    return true;
  }

  private async sendNotice(to: string, name: string, locale: 'en' | 'bn'): Promise<void> {
    await this.deliver(
      renderEmail('accountExists', locale, { to, name, appUrl: this.config.APP_BASE_URL }),
    );
  }

  /** Email failures are logged, not surfaced: the user can request a new code. */
  private async deliver(message: Parameters<EmailSender['send']>[0]): Promise<void> {
    try {
      await this.email.send(message);
    } catch (err) {
      this.logger.error({ err }, 'Failed to send email');
    }
  }
}

function invalidCode(): AppException {
  return new AppException(
    'INVALID_OR_EXPIRED_CODE',
    'The code is invalid or has expired. Request a new one.',
    HttpStatus.BAD_REQUEST,
  );
}

function sessionExpired(): AppException {
  return new AppException(
    'UNAUTHENTICATED',
    'Your session has expired. Please log in again.',
    HttpStatus.UNAUTHORIZED,
  );
}
