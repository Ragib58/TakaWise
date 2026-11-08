import { HttpStatus, Injectable } from '@nestjs/common';
import {
  EVERYDAY_ACCOUNT_TYPES,
  type EntitlementFeature,
  type PlanEntitlements,
  type PlanResponse,
  type SubscriptionResponse,
} from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import {
  canAddAccount,
  FREE_PLAN,
  isSubscriptionEffective,
  LIVE_STATUSES,
  parseEntitlements,
  withFamilyCover,
} from '../../domain/saas/entitlements';
import { toMoneyString, money } from '../../domain/money/money';
import { PrismaService } from '../../database/prisma.service';
import { DEFAULT_PLANS } from '../../database/seed/saas-defaults';
import type { Prisma } from '../../generated/prisma/client';

type Db = PrismaService | Prisma.TransactionClient;

type PlanRow = {
  code: string;
  name: string;
  priceAmount: { toString(): string };
  currency: string;
  interval: 'MONTH' | 'YEAR';
  active: boolean;
  entitlements: unknown;
};

type SubscriptionRow = {
  id: string;
  planCode: string;
  status: SubscriptionResponse['status'];
  provider: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
};

export type Effective = {
  plan: PlanResponse;
  subscription: SubscriptionResponse | null;
  entitlements: PlanEntitlements;
  coveredBy: string | null;
};

export function toPlanResponse(row: PlanRow): PlanResponse {
  return {
    code: row.code,
    name: row.name,
    priceAmount: toMoneyString(money(row.priceAmount)),
    currency: row.currency,
    interval: row.interval,
    active: row.active,
    entitlements: parseEntitlements(row.entitlements),
  };
}

export function toSubscriptionResponse(row: SubscriptionRow): SubscriptionResponse {
  return {
    id: row.id,
    planCode: row.planCode,
    status: row.status,
    provider: row.provider,
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

const FREE_FALLBACK = DEFAULT_PLANS.find((p) => p.code === FREE_PLAN)!;

export function planRequired(feature: EntitlementFeature, message: string): AppException {
  return new AppException('PLAN_REQUIRED', message, HttpStatus.FORBIDDEN, [
    { field: feature, message },
  ]);
}

/**
 * Resolves what a user may do right now (ADR-025): their live subscription's
 * plan (or FREE), plus cover from a family workspace whose owner holds a plan
 * with family workspaces. Computed on every check — nothing is cached, so a
 * lapsed plan or a removed member loses access immediately.
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async liveSubscription(userId: string, db: Db = this.prisma, now = new Date()) {
    const sub = await db.subscription.findFirst({
      where: { userId, status: { in: [...LIVE_STATUSES] } },
      include: { plan: true },
    });
    return sub && isSubscriptionEffective(sub, now) ? sub : null;
  }

  private async freePlan(db: Db): Promise<PlanResponse> {
    const row = await db.plan.findUnique({ where: { code: FREE_PLAN } });
    return row
      ? toPlanResponse(row)
      : {
          code: FREE_PLAN,
          name: FREE_FALLBACK.name,
          priceAmount: '0.0000',
          currency: 'BDT',
          interval: 'MONTH',
          active: true,
          entitlements: FREE_FALLBACK.entitlements,
        };
  }

  async effective(userId: string, db: Db = this.prisma): Promise<Effective> {
    const now = new Date();
    const sub = await this.liveSubscription(userId, db, now);
    const plan = sub ? toPlanResponse(sub.plan) : await this.freePlan(db);

    // Family cover: the owner's plan must itself be live and include workspaces.
    const memberships = await db.familyMember.findMany({
      where: { userId, status: 'ACTIVE', role: { not: 'OWNER' } },
      select: { workspace: { select: { name: true, ownerId: true } } },
    });
    let cover: PlanEntitlements | null = null;
    let coveredBy: string | null = null;
    for (const m of memberships) {
      const ownerSub = await this.liveSubscription(m.workspace.ownerId, db, now);
      const ownerEntitlements = ownerSub ? parseEntitlements(ownerSub.plan.entitlements) : null;
      if (ownerEntitlements?.familyWorkspace) {
        cover = ownerEntitlements;
        coveredBy = m.workspace.name;
        break;
      }
    }
    return {
      plan,
      subscription: sub ? toSubscriptionResponse(sub) : null,
      entitlements: withFamilyCover(plan.entitlements, cover),
      coveredBy,
    };
  }

  countAccounts(userId: string, db: Db = this.prisma): Promise<number> {
    return db.financialAccount.count({
      where: { userId, status: 'ACTIVE', type: { in: [...EVERYDAY_ACCOUNT_TYPES] } },
    });
  }

  /** Call inside the creating transaction so the count and the insert agree. */
  async assertCanAddAccount(userId: string, db: Db = this.prisma): Promise<void> {
    const [{ entitlements }, count] = await Promise.all([
      this.effective(userId, db),
      this.countAccounts(userId, db),
    ]);
    if (!canAddAccount(entitlements, count)) {
      throw planRequired(
        'accounts',
        `Your plan allows ${String(entitlements.maxAccounts)} active accounts. Archive one or upgrade.`,
      );
    }
  }

  async assertFeature(
    userId: string,
    feature: 'aiInsights' | 'aiDrafts' | 'receiptOcr' | 'familyWorkspace',
  ): Promise<void> {
    const { entitlements } = await this.effective(userId);
    if (!entitlements[feature]) {
      throw planRequired(feature, 'Your plan does not include this feature.');
    }
  }
}
