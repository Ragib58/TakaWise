import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export type DispatchResult = { notified: number };

/**
 * Turns due reminders into in-app notifications. Safe to run concurrently on
 * several workers/instances: rows are claimed with FOR UPDATE SKIP LOCKED and
 * marked `notified_at` in the same transaction, so each reminder is notified
 * exactly once (until it is rescheduled).
 */
@Injectable()
export class ReminderDispatcher {
  private readonly logger = new Logger(ReminderDispatcher.name);

  constructor(private readonly prisma: PrismaService) {}

  async dispatchDue(now: Date = new Date(), batchSize = 100): Promise<DispatchResult> {
    const notified = await this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<
        Array<{ id: string; user_id: string; title: string; due_at: Date }>
      >`
        SELECT "id", "user_id", "title", "due_at"
          FROM "reminders"
         WHERE "status" = 'PENDING' AND "notified_at" IS NULL AND "due_at" <= ${now}
         ORDER BY "due_at"
         LIMIT ${batchSize}
         FOR UPDATE SKIP LOCKED`;
      if (due.length === 0) return 0;

      await tx.notification.createMany({
        data: due.map((r) => ({
          userId: r.user_id,
          kind: 'REMINDER_DUE' as const,
          title: r.title,
          payload: { reminderId: r.id, dueAt: r.due_at.toISOString() },
        })),
      });
      await tx.reminder.updateMany({
        where: { id: { in: due.map((r) => r.id) } },
        data: { notifiedAt: now },
      });
      return due.length;
    });
    if (notified > 0) this.logger.log(`Dispatched ${notified} reminder notification(s)`);
    return { notified };
  }
}
