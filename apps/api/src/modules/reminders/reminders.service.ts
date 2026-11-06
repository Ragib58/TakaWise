import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  CreateReminderRequest,
  ListRemindersQuery,
  ReminderResponse,
  UpdateReminderRequest,
} from '@takawise/contracts';
import { Paginated } from '../../common/envelope/paginated';
import { AppException } from '../../common/errors/app.exception';
import type { ClientContext } from '../../common/http/client-context';
import { localDateOf } from '../../domain/time/local-date';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma, Reminder } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { userTimeZone } from '../transactions/posting-rules';

const notFound = () => new AppException('NOT_FOUND', 'Reminder not found.', HttpStatus.NOT_FOUND);

export function toReminderResponse(r: Reminder, now = new Date()): ReminderResponse {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    dueAt: r.dueAt.toISOString(),
    timezone: r.timezone,
    dueDate: localDateOf(r.dueAt, r.timezone),
    status: r.status,
    pastDue: r.status === 'PENDING' && r.dueAt <= now,
    completedAt: r.completedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** REM-01: one-time bill/event reminders. `dueAt` is an absolute UTC instant (ADR-012). */
@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    input: CreateReminderRequest,
    client: ClientContext,
  ): Promise<ReminderResponse> {
    const dueAt = this.futureInstant(input.dueAt);
    const reminder = await this.prisma.$transaction(async (tx) => {
      const created = await tx.reminder.create({
        data: {
          userId,
          title: input.title,
          notes: input.notes ?? null,
          dueAt,
          timezone: await userTimeZone(tx, userId),
        },
      });
      await this.audit.record(
        { action: 'reminder.created', userId, entityType: 'reminder', entityId: created.id },
        client,
        tx,
      );
      return created;
    });
    return toReminderResponse(reminder);
  }

  async list(userId: string, query: ListRemindersQuery): Promise<Paginated<ReminderResponse>> {
    const now = new Date();
    const where: Prisma.ReminderWhereInput = { userId };
    let orderBy: Prisma.ReminderOrderByWithRelationInput = { dueAt: 'asc' };
    if (query.view === 'upcoming') Object.assign(where, { status: 'PENDING', dueAt: { gt: now } });
    if (query.view === 'past_due') Object.assign(where, { status: 'PENDING', dueAt: { lte: now } });
    if (query.view === 'done') {
      Object.assign(where, { status: { in: ['DONE', 'CANCELLED'] } });
      orderBy = { dueAt: 'desc' };
    }
    // Separate, parallel reads: no transaction holding a pooled connection.
    const [total, rows] = await Promise.all([
      this.prisma.reminder.count({ where }),
      this.prisma.reminder.findMany({
        where,
        orderBy: [orderBy, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return new Paginated(
      rows.map((r) => toReminderResponse(r, now)),
      query.page,
      query.pageSize,
      total,
    );
  }

  async get(userId: string, id: string): Promise<ReminderResponse> {
    return toReminderResponse(await this.findOwned(userId, id));
  }

  async update(
    userId: string,
    id: string,
    input: UpdateReminderRequest,
    client: ClientContext,
  ): Promise<ReminderResponse> {
    const reminder = await this.findOwned(userId, id);
    if (reminder.status !== 'PENDING') {
      throw new AppException(
        'CONFLICT',
        'Only pending reminders can be changed.',
        HttpStatus.CONFLICT,
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.reminder.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          // Rescheduling makes it due again, so it will be notified again.
          ...(input.dueAt !== undefined
            ? { dueAt: this.futureInstant(input.dueAt), notifiedAt: null }
            : {}),
        },
      });
      await this.audit.record(
        {
          action: 'reminder.updated',
          userId,
          entityType: 'reminder',
          entityId: id,
          metadata: { fields: Object.keys(input) },
        },
        client,
        tx,
      );
      return row;
    });
    return toReminderResponse(updated);
  }

  async complete(userId: string, id: string, client: ClientContext): Promise<ReminderResponse> {
    return this.transition(userId, id, 'DONE', client);
  }

  async cancel(userId: string, id: string, client: ClientContext): Promise<ReminderResponse> {
    return this.transition(userId, id, 'CANCELLED', client);
  }

  private async transition(
    userId: string,
    id: string,
    status: 'DONE' | 'CANCELLED',
    client: ClientContext,
  ): Promise<ReminderResponse> {
    const reminder = await this.findOwned(userId, id);
    if (reminder.status === status) return toReminderResponse(reminder);
    if (reminder.status !== 'PENDING') {
      throw new AppException('CONFLICT', 'This reminder is already closed.', HttpStatus.CONFLICT);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.reminder.update({
        where: { id },
        data: { status, completedAt: status === 'DONE' ? new Date() : null },
      });
      await this.audit.record(
        {
          action: status === 'DONE' ? 'reminder.completed' : 'reminder.cancelled',
          userId,
          entityType: 'reminder',
          entityId: id,
        },
        client,
        tx,
      );
      return row;
    });
    return toReminderResponse(updated);
  }

  private async findOwned(userId: string, id: string): Promise<Reminder> {
    const reminder = await this.prisma.reminder.findFirst({ where: { id, userId } });
    if (!reminder) throw notFound();
    return reminder;
  }

  private futureInstant(value: string): Date {
    const dueAt = new Date(value);
    if (dueAt.getTime() <= Date.now()) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Please check the submitted fields.',
        HttpStatus.BAD_REQUEST,
        [{ field: 'dueAt', message: 'Choose a time in the future' }],
      );
    }
    return dueAt;
  }
}
