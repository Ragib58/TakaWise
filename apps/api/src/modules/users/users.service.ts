import { HttpStatus, Injectable } from '@nestjs/common';
import type { ChangePasswordRequest, MeResponse, UpdateMeRequest } from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import type { ClientContext } from '../../common/http/client-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.decorators';
import { PasswordHasher } from '../auth/crypto/password-hasher.service';
import { passwordPolicyViolation } from '../auth/crypto/password-policy';
import { SessionsService } from '../auth/sessions.service';
import { toDbLocale, toMeResponse } from './user.mapper';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionsService,
  ) {}

  async getMe(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new AppException('NOT_FOUND', 'User not found.', HttpStatus.NOT_FOUND);
    return toMeResponse(user);
  }

  async updateMe(
    userId: string,
    input: UpdateMeRequest,
    client: ClientContext,
  ): Promise<MeResponse> {
    const data = {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.locale !== undefined ? { locale: toDbLocale(input.locale) } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.defaultCurrency !== undefined ? { defaultCurrency: input.defaultCurrency } : {}),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.userProfile.update({ where: { userId }, data });
      await this.audit.record(
        {
          action: 'user.profile.updated',
          userId,
          entityType: 'user_profile',
          entityId: userId,
          metadata: { fields: Object.keys(data) },
        },
        client,
        tx,
      );
    });
    return this.getMe(userId);
  }

  /** Changes the password and signs out every other session. */
  async changePassword(
    auth: AuthContext,
    input: ChangePasswordRequest,
    client: ClientContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      include: { profile: true },
    });
    if (!(await this.hasher.verify(user.passwordHash, input.currentPassword))) {
      throw new AppException(
        'INVALID_CREDENTIALS',
        'Your current password is incorrect.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const violation = passwordPolicyViolation(input.newPassword, {
      email: user.email,
      fullName: user.profile?.fullName,
    });
    if (violation) throw new AppException('WEAK_PASSWORD', violation, HttpStatus.BAD_REQUEST);

    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await this.sessions.revokeAllForUser(user.id, 'PASSWORD_CHANGED', {
        exceptSessionId: auth.sessionId,
        db: tx,
      });
      await this.audit.record({ action: 'auth.password_changed', userId: user.id }, client, tx);
    });
  }
}
