import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  ContributionResponse,
  CreateContributionRequest,
  CreateGoalRequest,
  GoalDetailResponse,
  GoalResponse,
  UpdateGoalRequest,
} from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import type { ClientContext } from '../../common/http/client-context';
import {
  money,
  type Money,
  parsePositiveMoney,
  toMoneyString,
  ZERO,
} from '../../domain/money/money';
import { ledgerClassForAccountType } from '../../domain/ledger/ledger-rules';
import { goalProgress, savedAmount, unallocated } from '../../domain/planning/goal-math';
import { dateOnly, localDateOf, toIsoDate } from '../../domain/time/local-date';
import { PrismaService } from '../../database/prisma.service';
import type { GoalContribution, Prisma, SavingsGoal } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService, type IdempotentResult } from '../idempotency/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { userTimeZone } from '../transactions/posting-rules';

type Db = PrismaService | Prisma.TransactionClient;

const goalInclude = {
  linkedAccount: { include: { ledgerAccount: { select: { id: true, normalBalance: true } } } },
  contributions: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SavingsGoalInclude;
type GoalWithRefs = Prisma.SavingsGoalGetPayload<{ include: typeof goalInclude }>;

const OPEN_STATUSES = ['ACTIVE', 'ACHIEVED'] as const;

const notFound = (what = 'Goal') =>
  new AppException('NOT_FOUND', `${what} not found.`, HttpStatus.NOT_FOUND);
const conflict = (message: string, field?: string) =>
  new AppException('CONFLICT', message, HttpStatus.CONFLICT, field ? [{ field, message }] : []);
const invalid = (field: string, message: string) =>
  new AppException(
    'VALIDATION_ERROR',
    'Please check the submitted fields.',
    HttpStatus.BAD_REQUEST,
    [{ field, message }],
  );

function toContributionResponse(c: GoalContribution): ContributionResponse {
  return {
    id: c.id,
    kind: c.kind,
    status: c.status,
    amount: c.amount.toFixed(4),
    contributedOn: toIsoDate(c.contributedOn),
    note: c.note,
    reversesId: c.reversesId,
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * Savings goals with the EARMARK model (ADR-009): a contribution sets aside
 * part of the linked account's balance; no money moves and no journal is posted.
 * Progress is derived only from the append-only contribution history, and the
 * total earmarked across an account's open goals may never exceed its balance
 * at the time money is set aside.
 */
@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    input: CreateGoalRequest,
    client: ClientContext,
  ): Promise<GoalResponse> {
    const account = await this.prisma.financialAccount.findFirst({
      where: { id: input.linkedAccountId, userId },
    });
    if (!account) throw notFound('Account');
    if (ledgerClassForAccountType(account.type) === 'LIABILITY') {
      throw invalid(
        'linkedAccountId',
        'Choose a cash, bank, wallet or savings account — not a credit card or loan',
      );
    }
    if (account.status !== 'ACTIVE') throw conflict('This account is archived.', 'linkedAccountId');

    const goal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.savingsGoal.create({
        data: {
          userId,
          name: input.name,
          targetAmount: toMoneyString(parsePositiveMoney(input.targetAmount)),
          currency: account.currency,
          targetDate: input.targetDate ? dateOnly(input.targetDate) : null,
          linkedAccountId: account.id,
        },
      });
      await this.audit.record(
        { action: 'goal.created', userId, entityType: 'savings_goal', entityId: created.id },
        client,
        tx,
      );
      return created;
    });
    return this.get(userId, goal.id);
  }

  async list(
    userId: string,
    status: 'ACTIVE' | 'ACHIEVED' | 'ARCHIVED' | 'OPEN' | 'ALL',
  ): Promise<GoalResponse[]> {
    const goals = await this.prisma.savingsGoal.findMany({
      where: {
        userId,
        ...(status === 'ALL'
          ? {}
          : status === 'OPEN'
            ? { status: { in: [...OPEN_STATUSES] } }
            : { status }),
      },
      include: goalInclude,
      orderBy: [{ status: 'asc' }, { targetDate: 'asc' }, { createdAt: 'asc' }],
    });
    return this.toResponses(this.prisma, goals);
  }

  async get(userId: string, id: string): Promise<GoalDetailResponse> {
    const goal = await this.prisma.savingsGoal.findFirst({
      where: { id, userId },
      include: goalInclude,
    });
    if (!goal) throw notFound();
    const [response] = await this.toResponses(this.prisma, [goal]);
    return { ...response!, contributions: goal.contributions.map(toContributionResponse) };
  }

  async update(
    userId: string,
    id: string,
    input: UpdateGoalRequest,
    client: ClientContext,
  ): Promise<GoalDetailResponse> {
    const goal = await this.findOwned(this.prisma, userId, id);
    if (goal.status === 'ARCHIVED') throw conflict('This goal is archived.');
    await this.prisma.$transaction(async (tx) => {
      await tx.savingsGoal.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.targetAmount !== undefined
            ? { targetAmount: toMoneyString(parsePositiveMoney(input.targetAmount)) }
            : {}),
          ...(input.targetDate !== undefined
            ? { targetDate: input.targetDate ? dateOnly(input.targetDate) : null }
            : {}),
        },
      });
      await this.syncStatus(tx, userId, id);
      await this.audit.record(
        {
          action: 'goal.updated',
          userId,
          entityType: 'savings_goal',
          entityId: id,
          metadata: { fields: Object.keys(input) },
        },
        client,
        tx,
      );
    });
    return this.get(userId, id);
  }

  /** Archiving releases the goal's earmark; its history is kept. */
  async archive(userId: string, id: string, client: ClientContext): Promise<GoalDetailResponse> {
    const goal = await this.findOwned(this.prisma, userId, id);
    if (goal.status !== 'ARCHIVED') {
      await this.prisma.$transaction(async (tx) => {
        await tx.savingsGoal.update({
          where: { id },
          data: { status: 'ARCHIVED', archivedAt: new Date() },
        });
        await this.audit.record(
          { action: 'goal.archived', userId, entityType: 'savings_goal', entityId: id },
          client,
          tx,
        );
      });
    }
    return this.get(userId, id);
  }

  addContribution(
    userId: string,
    goalId: string,
    input: CreateContributionRequest,
    idempotencyKey: string,
    client: ClientContext,
  ): Promise<IdempotentResult<GoalDetailResponse>> {
    const amount = parsePositiveMoney(input.amount);
    return this.idempotency.execute({
      userId,
      key: idempotencyKey,
      scope: 'POST /goals/:id/contributions',
      request: { goalId, ...input },
      responseStatus: HttpStatus.CREATED,
      run: async (tx) => {
        const goal = await this.findOwned(tx, userId, goalId);
        if (goal.status === 'ARCHIVED') throw conflict('This goal is archived.');
        // Serialise earmark changes per account so two requests cannot both pass the cap.
        await tx.$queryRaw`SELECT "id" FROM "financial_accounts" WHERE "id" = ${goal.linkedAccountId}::uuid FOR UPDATE`;

        const today = localDateOf(new Date(), await userTimeZone(tx, userId));
        const contributedOn = input.contributedOn ?? today;
        if (contributedOn > today) throw invalid('contributedOn', 'Cannot be in the future');

        const saved = savedAmount(await tx.goalContribution.findMany({ where: { goalId } }));
        if (input.kind === 'CONTRIBUTION') {
          const account = await tx.financialAccount.findUniqueOrThrow({
            where: { id: goal.linkedAccountId },
            include: { ledgerAccount: true },
          });
          if (account.status !== 'ACTIVE') throw conflict('The linked account is archived.');
          const balance =
            (await this.ledger.balances(tx, [account.ledgerAccount!])).get(
              account.ledgerAccount!.id,
            ) ?? ZERO;
          const available = unallocated(
            balance,
            (await this.earmarks(tx, [account.id])).get(account.id) ?? ZERO,
          );
          if (amount.greaterThan(available)) {
            throw conflict(
              `Only ${toMoneyString(available)} ${account.currency} in ${account.name} is not yet set aside for a goal.`,
              'amount',
            );
          }
        } else if (amount.greaterThan(saved)) {
          throw invalid(
            'amount',
            `You can withdraw at most ${toMoneyString(saved)} from this goal`,
          );
        }

        const row = await tx.goalContribution.create({
          data: {
            goalId,
            userId,
            kind: input.kind,
            amount: toMoneyString(amount),
            contributedOn: dateOnly(contributedOn),
            note: input.note ?? null,
          },
        });
        await this.syncStatus(tx, userId, goalId);
        await this.audit.record(
          {
            action: 'goal.contribution.posted',
            userId,
            entityType: 'goal_contribution',
            entityId: row.id,
            metadata: { kind: input.kind },
          },
          client,
          tx,
        );
        return this.detailIn(tx, userId, goalId);
      },
    });
  }

  /** Corrections append a REVERSAL row; nothing is edited or deleted (GOAL-02). */
  reverseContribution(
    userId: string,
    goalId: string,
    contributionId: string,
    idempotencyKey: string,
    client: ClientContext,
  ): Promise<IdempotentResult<GoalDetailResponse>> {
    return this.idempotency.execute({
      userId,
      key: idempotencyKey,
      scope: 'POST /goals/:id/contributions/:cid/reverse',
      request: { goalId, contributionId },
      responseStatus: HttpStatus.OK,
      run: async (tx) => {
        const goal = await this.findOwned(tx, userId, goalId);
        await tx.$queryRaw`SELECT "id" FROM "financial_accounts" WHERE "id" = ${goal.linkedAccountId}::uuid FOR UPDATE`;
        const original = await tx.goalContribution.findFirst({
          where: { id: contributionId, goalId, userId },
        });
        if (!original) throw notFound('Contribution');
        if (original.kind === 'REVERSAL' || original.status !== 'POSTED') {
          throw conflict('This entry has already been reversed or is itself a reversal.');
        }
        const today = localDateOf(new Date(), await userTimeZone(tx, userId));
        await tx.goalContribution.create({
          data: {
            goalId,
            userId,
            kind: 'REVERSAL',
            amount: original.amount,
            contributedOn: dateOnly(today),
            reversesId: original.id,
          },
        });
        await tx.goalContribution.update({
          where: { id: original.id },
          data: { status: 'REVERSED' },
        });
        await this.syncStatus(tx, userId, goalId);
        await this.audit.record(
          {
            action: 'goal.contribution.reversed',
            userId,
            entityType: 'goal_contribution',
            entityId: original.id,
          },
          client,
          tx,
        );
        return this.detailIn(tx, userId, goalId);
      },
    });
  }

  // ─────────────────────────────── Helpers ───────────────────────────────

  private async findOwned(db: Db, userId: string, id: string): Promise<SavingsGoal> {
    const goal = await db.savingsGoal.findFirst({ where: { id, userId } });
    if (!goal) throw notFound();
    return goal;
  }

  /** ACTIVE ⇄ ACHIEVED follows the contribution history; notifies once on achievement. */
  private async syncStatus(
    tx: Prisma.TransactionClient,
    userId: string,
    goalId: string,
  ): Promise<void> {
    const goal = await tx.savingsGoal.findUniqueOrThrow({
      where: { id: goalId },
      include: { contributions: true },
    });
    if (goal.status === 'ARCHIVED') return;
    const { achieved } = goalProgress(money(goal.targetAmount), savedAmount(goal.contributions));
    if (achieved && goal.status === 'ACTIVE') {
      await tx.savingsGoal.update({
        where: { id: goalId },
        data: { status: 'ACHIEVED', achievedAt: new Date() },
      });
      await tx.notification.create({
        data: {
          userId,
          kind: 'GOAL_ACHIEVED',
          title: `Goal reached: ${goal.name}`,
          payload: { goalId },
        },
      });
    } else if (!achieved && goal.status === 'ACHIEVED') {
      await tx.savingsGoal.update({
        where: { id: goalId },
        data: { status: 'ACTIVE', achievedAt: null },
      });
    }
  }

  /** Σ saved over each account's open (non-archived) goals. */
  private async earmarks(db: Db, accountIds: string[]): Promise<Map<string, Money>> {
    const rows = await db.goalContribution.findMany({
      where: { goal: { linkedAccountId: { in: accountIds }, status: { in: [...OPEN_STATUSES] } } },
      select: {
        kind: true,
        status: true,
        amount: true,
        goal: { select: { linkedAccountId: true } },
      },
    });
    const result = new Map<string, Money>(accountIds.map((id) => [id, ZERO]));
    for (const id of accountIds) {
      result.set(id, savedAmount(rows.filter((r) => r.goal.linkedAccountId === id)));
    }
    return result;
  }

  private async detailIn(
    tx: Prisma.TransactionClient,
    userId: string,
    goalId: string,
  ): Promise<GoalDetailResponse> {
    const goal = await tx.savingsGoal.findFirstOrThrow({
      where: { id: goalId, userId },
      include: goalInclude,
    });
    const [response] = await this.toResponses(tx, [goal]);
    return { ...response!, contributions: goal.contributions.map(toContributionResponse) };
  }

  private async toResponses(db: Db, goals: GoalWithRefs[]): Promise<GoalResponse[]> {
    const accounts = [...new Map(goals.map((g) => [g.linkedAccount.id, g.linkedAccount])).values()];
    const ledgers = accounts.flatMap((a) => (a.ledgerAccount ? [a.ledgerAccount] : []));
    const balances = await this.ledger.balances(db, ledgers);
    const earmarked = await this.earmarks(
      db,
      accounts.map((a) => a.id),
    );

    return goals.map((goal) => {
      const saved = savedAmount(goal.contributions);
      const progress = goalProgress(money(goal.targetAmount), saved);
      const account = goal.linkedAccount;
      const balance = (account.ledgerAccount && balances.get(account.ledgerAccount.id)) ?? ZERO;
      const accountEarmarked = earmarked.get(account.id) ?? ZERO;
      return {
        id: goal.id,
        name: goal.name,
        status: goal.status,
        currency: goal.currency,
        targetAmount: goal.targetAmount.toFixed(4),
        targetDate: goal.targetDate ? toIsoDate(goal.targetDate) : null,
        saved: progress.saved,
        remaining: progress.remaining,
        percent: progress.percent,
        achievedAt: goal.achievedAt?.toISOString() ?? null,
        linkedAccount: {
          id: account.id,
          name: account.name,
          type: account.type,
          balance: toMoneyString(balance),
          earmarked: toMoneyString(accountEarmarked),
        },
        underFunded: goal.status !== 'ARCHIVED' && accountEarmarked.greaterThan(balance),
        createdAt: goal.createdAt.toISOString(),
      };
    });
  }
}
