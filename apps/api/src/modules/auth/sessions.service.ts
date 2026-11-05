import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { SessionSummary } from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import type { ClientContext } from '../../common/http/client-context';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { generateRefreshToken, sha256Hex } from './crypto/secure-tokens';

export type RevokeReason =
  | 'ROTATED'
  | 'LOGOUT'
  | 'LOGOUT_ALL'
  | 'REVOKED_BY_USER'
  | 'PASSWORD_RESET'
  | 'PASSWORD_CHANGED'
  | 'REUSE_DETECTED';

type Db = PrismaService | Prisma.TransactionClient;

export type IssuedSession = { sessionId: string; refreshToken: string };

export type RotationResult =
  | { ok: true; userId: string; sessionId: string; refreshToken: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'reuse_detected'; userId?: string };

/**
 * Refresh-token sessions with rotation and reuse detection (ADR-011).
 * Each refresh replaces the session row; presenting an already-rotated token
 * means it was stolen or replayed, so the whole login family is revoked.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private expiry(): Date {
    return new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  }

  async create(
    userId: string,
    client: ClientContext,
    db: Db = this.prisma,
    familyId: string = randomUUID(),
  ): Promise<IssuedSession> {
    const refreshToken = generateRefreshToken();
    const session = await db.session.create({
      data: {
        userId,
        familyId,
        refreshTokenHash: sha256Hex(refreshToken),
        userAgent: client.userAgent,
        ipHash: this.audit.ipHash(client.ip),
        expiresAt: this.expiry(),
      },
    });
    return { sessionId: session.id, refreshToken };
  }

  async rotate(refreshToken: string, client: ClientContext): Promise<RotationResult> {
    const result = await this.prisma.$transaction(async (tx): Promise<RotationResult> => {
      const current = await tx.session.findUnique({
        where: { refreshTokenHash: sha256Hex(refreshToken) },
      });
      if (!current) return { ok: false, reason: 'unknown' };

      if (current.revokedAt) {
        if (current.revokedReason !== 'ROTATED') return { ok: false, reason: 'revoked' };
        await this.revokeWhere(tx, { familyId: current.familyId }, 'REUSE_DETECTED');
        return { ok: false, reason: 'reuse_detected', userId: current.userId };
      }
      if (current.expiresAt <= new Date()) return { ok: false, reason: 'expired' };

      // Conditional update: of two concurrent refreshes with one token, only one wins.
      const claimed = await tx.session.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
      });
      if (claimed.count !== 1) {
        await this.revokeWhere(tx, { familyId: current.familyId }, 'REUSE_DETECTED');
        return { ok: false, reason: 'reuse_detected', userId: current.userId };
      }

      const next = await this.create(current.userId, client, tx, current.familyId);
      await tx.session.update({
        where: { id: current.id },
        data: { replacedById: next.sessionId },
      });
      return { ok: true, userId: current.userId, ...next };
    });

    if (!result.ok && result.reason === 'reuse_detected') {
      await this.audit.recordSafely(
        { action: 'auth.refresh.reuse_detected', userId: result.userId ?? null },
        client,
      );
    }
    return result;
  }

  async revokeByRefreshToken(refreshToken: string, reason: RevokeReason): Promise<string | null> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: sha256Hex(refreshToken) },
      select: { id: true, userId: true },
    });
    if (!session) return null;
    await this.revokeWhere(this.prisma, { id: session.id }, reason);
    return session.userId;
  }

  revokeAllForUser(
    userId: string,
    reason: RevokeReason,
    options: { exceptSessionId?: string; db?: Db } = {},
  ): Promise<number> {
    return this.revokeWhere(
      options.db ?? this.prisma,
      { userId, ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}) },
      reason,
    );
  }

  /** Revokes one of the caller's own sessions; another user's id is a 404 (ADR-013). */
  async revokeOwned(userId: string, sessionId: string): Promise<void> {
    const count = await this.revokeWhere(this.prisma, { id: sessionId, userId }, 'REVOKED_BY_USER');
    if (count === 0) {
      throw new AppException('NOT_FOUND', 'Session not found.', HttpStatus.NOT_FOUND);
    }
  }

  async listActive(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  private async revokeWhere(
    db: Db,
    where: Prisma.SessionWhereInput,
    reason: RevokeReason,
  ): Promise<number> {
    const { count } = await db.session.updateMany({
      where: { ...where, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }
}
