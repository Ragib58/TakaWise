import { HttpStatus, Injectable } from '@nestjs/common';
import type { ListNotificationsQuery, NotificationResponse } from '@takawise/contracts';
import { Paginated } from '../../common/envelope/paginated';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import type { Notification, Prisma } from '../../generated/prisma/client';

function toNotificationResponse(n: Notification): NotificationResponse {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<Paginated<NotificationResponse>> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unread === 'true'
        ? { readAt: null }
        : query.unread === 'false'
          ? { readAt: { not: null } }
          : {}),
    };
    // Separate, parallel reads: no transaction holding a pooled connection.
    const [total, rows] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return new Paginated(rows.map(toNotificationResponse), query.page, query.pageSize, total);
  }

  async unreadCount(userId: string): Promise<{ unread: number }> {
    return { unread: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  async markRead(userId: string, id: string): Promise<NotificationResponse> {
    const row = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!row) throw new AppException('NOT_FOUND', 'Notification not found.', HttpStatus.NOT_FOUND);
    if (row.readAt) return toNotificationResponse(row);
    return toNotificationResponse(
      await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } }),
    );
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }
}
