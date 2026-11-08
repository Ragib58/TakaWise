import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AdminAnalyticsResponse,
  AdminUserResponse,
  FeatureFlagKey,
  GrantSubscriptionRequest,
  PlanResponse,
  PlatformRole,
  UpdatePlanRequest,
} from '@takawise/contracts';
import { FEATURE_FLAG_KEYS } from '@takawise/contracts';
import { AppException } from '../../../common/errors/app.exception';
import type { ClientContext } from '../../../common/http/client-context';
import { addMonthsUtc, LIVE_STATUSES } from '../../../domain/saas/entitlements';
import { parseMoney, toMoneyString } from '../../../domain/money/money';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import {
  EntitlementsService,
  toPlanResponse,
  toSubscriptionResponse,
} from '../entitlements.service';

const notFound = () =>
  new AppException('NOT_FOUND', 'The requested resource was not found.', HttpStatus.NOT_FOUND);

const DAY_MS = 86_400_000;

/**
 * Platform administration (ADR-027). Every method returns plan, subscription,
 * account-metadata or aggregate data only: there is deliberately no path from
 * here to accounts, transactions, budgets, goals or notes.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly billing: BillingService,
  ) {}

  async role(userId: string): Promise<PlatformRole> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { platformRole: true },
    });
    return user.platformRole;
  }

  // ─────────────────────────────── Plans ───────────────────────────────

  async plans(): Promise<PlanResponse[]> {
    const rows = await this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map(toPlanResponse);
  }

  async updatePlan(
    adminId: string,
    code: string,
    input: UpdatePlanRequest,
    client: ClientContext,
  ): Promise<PlanResponse> {
    const existing = await this.prisma.plan.findUnique({ where: { code } });
    if (!existing) throw notFound();
    if (
      code === 'FREE' &&
      (input.active === false ||
        (input.priceAmount !== undefined && !parseMoney(input.priceAmount).isZero()))
    ) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Please check the submitted fields.',
        HttpStatus.BAD_REQUEST,
        [{ field: 'priceAmount', message: 'The Free plan stays free and active' }],
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.plan.update({
        where: { code },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.priceAmount !== undefined
            ? { priceAmount: toMoneyString(parseMoney(input.priceAmount)) }
            : {}),
          ...(input.interval !== undefined ? { interval: input.interval } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.entitlements !== undefined ? { entitlements: input.entitlements } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'admin.plan.updated',
          userId: null,
          actorId: adminId,
          entityType: 'plan',
          metadata: { code, fields: Object.keys(input) },
        },
        client,
        tx,
      );
      return row;
    });
    return toPlanResponse(updated);
  }

  // ─────────────────────────────── Subscriptions ───────────────────────────────

  async subscriptions(status?: string) {
    const rows = await this.prisma.subscription.findMany({
      where: status ? { status: status as never } : {},
      include: { user: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((s) => ({
      ...toSubscriptionResponse(s),
      user: s.user,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  /** Complimentary grant (pilot users, goodwill). Replaces any live subscription. */
  async grant(
    adminId: string,
    userId: string,
    input: GrantSubscriptionRequest,
    client: ClientContext,
  ): Promise<AdminUserResponse> {
    await this.findUser(userId);
    const plan = await this.prisma.plan.findUnique({ where: { code: input.planCode } });
    if (!plan) throw notFound();
    await this.prisma.$transaction(async (tx) => {
      await this.billing.endLive(tx, userId);
      const sub = await tx.subscription.create({
        data: {
          userId,
          planCode: plan.code,
          status: 'ACTIVE',
          provider: 'admin',
          currentPeriodEnd: addMonthsUtc(new Date(), input.months),
          cancelAtPeriodEnd: true,
          note: input.note ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'admin.subscription.granted',
          userId,
          actorId: adminId,
          entityType: 'subscription',
          entityId: sub.id,
          metadata: { planCode: plan.code, months: input.months },
        },
        client,
        tx,
      );
    });
    return this.user(userId);
  }

  async cancelSubscription(
    adminId: string,
    userId: string,
    client: ClientContext,
  ): Promise<AdminUserResponse> {
    await this.findUser(userId);
    const live = await this.prisma.subscription.findFirst({
      where: { userId, status: { in: [...LIVE_STATUSES] } },
    });
    if (!live) throw notFound();
    await this.prisma.$transaction(async (tx) => {
      await this.billing.endLive(tx, userId);
      await this.audit.record(
        {
          action: 'admin.subscription.canceled',
          userId,
          actorId: adminId,
          entityType: 'subscription',
          entityId: live.id,
        },
        client,
        tx,
      );
    });
    return this.user(userId);
  }

  // ─────────────────────────────── Users ───────────────────────────────

  async findByEmail(email: string): Promise<AdminUserResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) throw notFound();
    return this.user(user.id);
  }

  async user(userId: string): Promise<AdminUserResponse> {
    const user = await this.findUser(userId);
    const sub = await this.entitlements.liveSubscription(userId);
    return {
      id: user.id,
      email: user.email,
      name: user.profile?.fullName ?? '',
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      platformRole: user.platformRole,
      createdAt: user.createdAt.toISOString(),
      subscription: sub ? toSubscriptionResponse(sub) : null,
    };
  }

  async setRole(adminId: string, userId: string, role: PlatformRole, client: ClientContext) {
    if (adminId === userId) {
      throw new AppException('CONFLICT', 'You cannot change your own role.', HttpStatus.CONFLICT);
    }
    const user = await this.findUser(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { platformRole: role } });
      await this.audit.record(
        {
          action: 'admin.role.changed',
          userId,
          actorId: adminId,
          entityType: 'user',
          entityId: userId,
          metadata: { from: user.platformRole, to: role },
        },
        client,
        tx,
      );
    });
    return this.user(userId);
  }

  // ─────────────────────────────── Feature flags ───────────────────────────────

  async flags() {
    const rows = await this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
    return rows.map((f) => ({
      key: f.key,
      enabled: f.enabled,
      description: f.description,
      updatedAt: f.updatedAt.toISOString(),
    }));
  }

  async setFlag(adminId: string, key: FeatureFlagKey, enabled: boolean, client: ClientContext) {
    if (!(FEATURE_FLAG_KEYS as readonly string[]).includes(key)) throw notFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.featureFlag.upsert({
        where: { key },
        create: { key, enabled, description: key, updatedById: adminId },
        update: { enabled, updatedById: adminId },
      });
      await this.audit.record(
        {
          action: 'admin.flag.updated',
          actorId: adminId,
          entityType: 'feature_flag',
          metadata: { key, enabled },
        },
        client,
        tx,
      );
    });
    return this.flags();
  }

  // ─────────────────────────────── Analytics ───────────────────────────────

  /** Aggregate counts only — no per-user rows, no financial amounts. */
  async analytics(): Promise<AdminAnalyticsResponse> {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const [total, active, verified, recent, signedIn, subs, workspaces, members, ai, tickets] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { status: 'ACTIVE' } }),
        this.prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
        this.prisma.user.count({ where: { createdAt: { gte: since } } }),
        this.prisma.session.groupBy({ by: ['userId'], where: { createdAt: { gte: since } } }),
        this.prisma.subscription.groupBy({
          by: ['planCode'],
          where: { status: { in: [...LIVE_STATUSES] }, currentPeriodEnd: { gt: now } },
          _count: { _all: true },
        }),
        this.prisma.familyWorkspace.count(),
        this.prisma.familyMember.count({ where: { status: 'ACTIVE' } }),
        this.prisma.aiRequest.groupBy({
          by: ['feature', 'status'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.supportTicket.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);
    return {
      generatedAt: now.toISOString(),
      users: {
        total,
        active,
        verified,
        newLast30Days: recent,
        signedInLast30Days: signedIn.length,
      },
      subscriptions: subs.map((s) => ({ planCode: s.planCode, live: s._count._all })),
      family: { workspaces, activeMembers: members },
      ai: ai.map((a) => ({ feature: a.feature, status: a.status, requests: a._count._all })),
      tickets: tickets.map((t) => ({ status: t.status, count: t._count._all })),
    };
  }

  private async findUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: { select: { fullName: true } } },
    });
    if (!user) throw notFound();
    return user;
  }
}
