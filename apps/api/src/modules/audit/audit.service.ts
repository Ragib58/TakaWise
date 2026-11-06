import { Inject, Injectable, Logger } from '@nestjs/common';
import { sanitizeForLog } from '../../common/errors/all-exceptions.filter';
import type { ClientContext } from '../../common/http/client-context';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { hmacHex } from '../auth/crypto/secure-tokens';

export type AuditAction =
  | 'auth.register'
  | 'auth.register.existing_email'
  | 'auth.email_verified'
  | 'auth.verification_code.sent'
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'auth.refresh.reuse_detected'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.session.revoked'
  | 'auth.password_reset.requested'
  | 'auth.password_reset.completed'
  | 'auth.password_changed'
  | 'user.profile.updated'
  | 'account.created'
  | 'account.updated'
  | 'account.archived'
  | 'account.restored'
  | 'transaction.posted'
  | 'transaction.reversed'
  | 'transfer.posted'
  | 'transfer.reversed'
  | 'category.created'
  | 'category.updated'
  | 'category.archived'
  | 'category.restored'
  | 'budget.created'
  | 'budget.updated'
  | 'budget.archived'
  | 'budget.restored'
  | 'goal.created'
  | 'goal.updated'
  | 'goal.archived'
  | 'goal.contribution.posted'
  | 'goal.contribution.reversed'
  | 'reminder.created'
  | 'reminder.updated'
  | 'reminder.completed'
  | 'reminder.cancelled'
  | 'export.transactions';

export type AuditEvent = {
  action: AuditAction;
  userId?: string | null;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  /** Redacted context only: never passwords, tokens, codes or notes. */
  metadata?: Prisma.InputJsonObject;
};

type Db = Pick<PrismaService, 'auditLog'> | Prisma.TransactionClient;

/** Append-only audit trail (audit_logs is immutable at the DB level). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  ipHash(ip: string | null): string | null {
    return ip ? hmacHex(this.config.AUTH_HMAC_SECRET, 'audit-ip', ip) : null;
  }

  /** Records inside the caller's transaction when `db` is a transaction client. */
  async record(event: AuditEvent, client: ClientContext, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        action: event.action,
        userId: event.userId ?? null,
        actorId: event.actorId ?? event.userId ?? null,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        requestId: client.requestId,
        ipHash: this.ipHash(client.ip),
        metadata: event.metadata ?? undefined,
      },
    });
  }

  /** For security events that must not fail the user's request (e.g. failed logins). */
  async recordSafely(event: AuditEvent, client: ClientContext): Promise<void> {
    try {
      await this.record(event, client);
    } catch (err) {
      this.logger.error(
        { err: sanitizeForLog(err), action: event.action },
        'Failed to write audit log',
      );
    }
  }
}
