import { HttpStatus, Injectable } from '@nestjs/common';
import type { AdminTicketResponse, CreateTicketRequest, TicketResponse } from '@takawise/contracts';
import { AppException } from '../../../common/errors/app.exception';
import type { ClientContext } from '../../../common/http/client-context';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { FeatureFlagsService } from '../feature-flags.service';

const notFound = () =>
  new AppException('NOT_FOUND', 'The requested resource was not found.', HttpStatus.NOT_FOUND);

const ticketInclude = { messages: { orderBy: { createdAt: 'asc' as const } } };

type TicketRow = {
  id: string;
  subject: string;
  category: TicketResponse['category'];
  status: TicketResponse['status'];
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{ id: string; fromStaff: boolean; body: string; createdAt: Date }>;
};

const toTicket = (t: TicketRow): TicketResponse => ({
  id: t.id,
  subject: t.subject,
  category: t.category,
  status: t.status,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
  messages: t.messages.map((m) => ({
    id: m.id,
    fromStaff: m.fromStaff,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  })),
});

/**
 * Support tickets (ADR-027). A ticket contains only what the user chose to
 * write; staff answer from it and limited account metadata, never from the
 * user's financial records. Audit rows never include message bodies.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagsService,
    private readonly audit: AuditService,
  ) {}

  // ─────────────── Customer side ───────────────

  async create(
    userId: string,
    input: CreateTicketRequest,
    client: ClientContext,
  ): Promise<TicketResponse> {
    await this.flags.assertOn('support.tickets');
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        subject: input.subject,
        category: input.category,
        messages: { create: { authorId: userId, fromStaff: false, body: input.body } },
      },
      include: ticketInclude,
    });
    await this.audit.record(
      {
        action: 'support.ticket.created',
        userId,
        entityType: 'support_ticket',
        entityId: ticket.id,
      },
      client,
    );
    return toTicket(ticket);
  }

  async listMine(userId: string): Promise<TicketResponse[]> {
    const rows = await this.prisma.supportTicket.findMany({
      where: { userId },
      include: ticketInclude,
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return rows.map(toTicket);
  }

  async getMine(userId: string, id: string): Promise<TicketResponse> {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, userId },
      include: ticketInclude,
    });
    if (!ticket) throw notFound();
    return toTicket(ticket);
  }

  async replyAsUser(
    userId: string,
    id: string,
    body: string,
    client: ClientContext,
  ): Promise<TicketResponse> {
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id, userId } });
    if (!ticket) throw notFound();
    if (ticket.status === 'CLOSED') {
      throw new AppException(
        'CONFLICT',
        'This ticket is closed. Open a new one.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.supportTicket.update({
      where: { id },
      data: { status: 'OPEN', messages: { create: { authorId: userId, fromStaff: false, body } } },
    });
    await this.audit.record(
      { action: 'support.ticket.replied', userId, entityType: 'support_ticket', entityId: id },
      client,
    );
    return this.getMine(userId, id);
  }

  // ─────────────── Staff side ───────────────

  async listAll(status?: TicketResponse['status']): Promise<AdminTicketResponse[]> {
    const rows = await this.prisma.supportTicket.findMany({
      where: status ? { status } : {},
      include: {
        ...ticketInclude,
        user: { select: { id: true, email: true, profile: { select: { fullName: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return rows.map((t) => this.toAdmin(t));
  }

  async getAny(id: string): Promise<AdminTicketResponse> {
    const t = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        ...ticketInclude,
        user: { select: { id: true, email: true, profile: { select: { fullName: true } } } },
      },
    });
    if (!t) throw notFound();
    return this.toAdmin(t);
  }

  async replyAsStaff(
    staffId: string,
    id: string,
    body: string,
    client: ClientContext,
  ): Promise<AdminTicketResponse> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw notFound();
    await this.prisma.supportTicket.update({
      where: { id },
      data: {
        status: ticket.status === 'CLOSED' ? 'CLOSED' : 'PENDING_USER',
        messages: { create: { authorId: staffId, fromStaff: true, body } },
      },
    });
    await this.audit.record(
      {
        action: 'support.ticket.replied',
        userId: ticket.userId,
        actorId: staffId,
        entityType: 'support_ticket',
        entityId: id,
      },
      client,
    );
    return this.getAny(id);
  }

  async setStatus(
    staffId: string,
    id: string,
    status: TicketResponse['status'],
    client: ClientContext,
  ): Promise<AdminTicketResponse> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw notFound();
    await this.prisma.supportTicket.update({ where: { id }, data: { status } });
    await this.audit.record(
      {
        action: 'support.ticket.status_changed',
        userId: ticket.userId,
        actorId: staffId,
        entityType: 'support_ticket',
        entityId: id,
        metadata: { from: ticket.status, to: status },
      },
      client,
    );
    return this.getAny(id);
  }

  private toAdmin(
    t: TicketRow & { user: { id: string; email: string; profile: { fullName: string } | null } },
  ): AdminTicketResponse {
    return {
      ...toTicket(t),
      user: { id: t.user.id, email: t.user.email, name: t.user.profile?.fullName ?? '' },
    };
  }
}
