import { HttpStatus, Injectable } from '@nestjs/common';
import type { BudgetResponse, CreateBudgetRequest, UpdateBudgetRequest } from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import { uniqueViolation } from '../../common/errors/prisma-errors';
import type { ClientContext } from '../../common/http/client-context';
import {
  money,
  type Money,
  parsePositiveMoney,
  sumMoney,
  toMoneyString,
  ZERO,
} from '../../domain/money/money';
import { monthRange, rollUpSpending, utilization } from '../../domain/planning/budget-math';
import { dateOnly, toIsoDate } from '../../domain/time/local-date';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';

const budgetInclude = {
  items: {
    include: { category: { select: { id: true, nameEn: true, nameBn: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.BudgetInclude;
type BudgetWithItems = Prisma.BudgetGetPayload<{ include: typeof budgetInclude }>;

type Db = PrismaService | Prisma.TransactionClient;

const notFound = () => new AppException('NOT_FOUND', 'Budget not found.', HttpStatus.NOT_FOUND);
const invalid = (field: string, message: string) =>
  new AppException(
    'VALIDATION_ERROR',
    'Please check the submitted fields.',
    HttpStatus.BAD_REQUEST,
    [{ field, message }],
  );

/**
 * BUD-01/BUD-02. Budgets are plans (editable), not postings. Utilization is
 * always computed from POSTED expense transactions in the period's effective
 * dates and currency, so transfers (never transactions) and reversed entries
 * (status REVERSED) are excluded and the numbers reconcile with the ledger.
 */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    input: CreateBudgetRequest & {
      currency: string;
      items: { categoryId: string; amount: string }[];
    },
    client: ClientContext,
  ): Promise<BudgetResponse> {
    const { start, end } = monthRange(input.month);
    await this.assertExpenseCategories(
      this.prisma,
      userId,
      input.items.map((i) => i.categoryId),
    );
    try {
      const budget = await this.prisma.$transaction(async (tx) => {
        const created = await tx.budget.create({
          data: {
            userId,
            name: input.name ?? `Budget ${input.month}`,
            period: 'MONTHLY',
            startDate: dateOnly(start),
            endDate: dateOnly(end),
            currency: input.currency,
            overallAmount: input.overallAmount
              ? toMoneyString(parsePositiveMoney(input.overallAmount))
              : null,
            items: {
              create: input.items.map((i) => ({
                categoryId: i.categoryId,
                amount: toMoneyString(parsePositiveMoney(i.amount)),
              })),
            },
          },
          include: budgetInclude,
        });
        await this.audit.record(
          { action: 'budget.created', userId, entityType: 'budget', entityId: created.id },
          client,
          tx,
        );
        return created;
      });
      return (await this.withUtilization(userId, [budget]))[0]!;
    } catch (error) {
      throw mapDuplicate(error);
    }
  }

  async list(
    userId: string,
    filter: { month?: string; status: 'ACTIVE' | 'ARCHIVED' | 'ALL' },
  ): Promise<BudgetResponse[]> {
    const budgets = await this.prisma.budget.findMany({
      where: {
        userId,
        ...(filter.month ? { startDate: dateOnly(monthRange(filter.month).start) } : {}),
        ...(filter.status === 'ACTIVE'
          ? { archivedAt: null }
          : filter.status === 'ARCHIVED'
            ? { archivedAt: { not: null } }
            : {}),
      },
      include: budgetInclude,
      orderBy: [{ startDate: 'desc' }, { currency: 'asc' }],
    });
    return this.withUtilization(userId, budgets);
  }

  async get(userId: string, id: string): Promise<BudgetResponse> {
    return (await this.withUtilization(userId, [await this.findOwned(userId, id)]))[0]!;
  }

  async update(
    userId: string,
    id: string,
    input: UpdateBudgetRequest,
    client: ClientContext,
  ): Promise<BudgetResponse> {
    const budget = await this.findOwned(userId, id);
    const nextItems = input.items ?? null;
    const nextOverall =
      input.overallAmount === undefined ? budget.overallAmount : input.overallAmount;
    if (nextOverall === null && (nextItems ?? budget.items).length === 0) {
      throw invalid('overallAmount', 'Set an overall limit or at least one category limit');
    }
    if (nextItems)
      await this.assertExpenseCategories(
        this.prisma,
        userId,
        nextItems.map((i) => i.categoryId),
      );

    await this.prisma.$transaction(async (tx) => {
      await tx.budget.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.overallAmount !== undefined
            ? {
                overallAmount:
                  input.overallAmount === null
                    ? null
                    : toMoneyString(parsePositiveMoney(input.overallAmount)),
              }
            : {}),
        },
      });
      if (nextItems) {
        await tx.budgetItem.deleteMany({ where: { budgetId: id } });
        await tx.budgetItem.createMany({
          data: nextItems.map((i) => ({
            budgetId: id,
            categoryId: i.categoryId,
            amount: toMoneyString(parsePositiveMoney(i.amount)),
          })),
        });
      }
      await this.audit.record(
        {
          action: 'budget.updated',
          userId,
          entityType: 'budget',
          entityId: id,
          metadata: { fields: Object.keys(input) },
        },
        client,
        tx,
      );
    });
    return this.get(userId, id);
  }

  async setArchived(
    userId: string,
    id: string,
    archived: boolean,
    client: ClientContext,
  ): Promise<BudgetResponse> {
    const budget = await this.findOwned(userId, id);
    if ((budget.archivedAt !== null) !== archived) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.budget.update({
            where: { id },
            data: { archivedAt: archived ? new Date() : null },
          });
          await this.audit.record(
            {
              action: archived ? 'budget.archived' : 'budget.restored',
              userId,
              entityType: 'budget',
              entityId: id,
            },
            client,
            tx,
          );
        });
      } catch (error) {
        throw mapDuplicate(error);
      }
    }
    return this.get(userId, id);
  }

  private async findOwned(userId: string, id: string): Promise<BudgetWithItems> {
    const budget = await this.prisma.budget.findFirst({
      where: { id, userId },
      include: budgetInclude,
    });
    if (!budget) throw notFound();
    return budget;
  }

  /** Budget limits apply to expense categories the user can use (system or own, active). */
  private async assertExpenseCategories(db: Db, userId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await db.category.findMany({
      where: { id: { in: ids }, OR: [{ userId: null }, { userId }] },
      select: { id: true, type: true, status: true },
    });
    for (const [index, id] of ids.entries()) {
      const category = found.find((c) => c.id === id);
      if (!category)
        throw new AppException('NOT_FOUND', 'Category not found.', HttpStatus.NOT_FOUND);
      if (category.type !== 'EXPENSE')
        throw invalid(`items.${index}.categoryId`, 'Budgets use expense categories');
      if (category.status !== 'ACTIVE')
        throw invalid(`items.${index}.categoryId`, 'This category is archived');
    }
  }

  private async withUtilization(
    userId: string,
    budgets: BudgetWithItems[],
  ): Promise<BudgetResponse[]> {
    return Promise.all(
      budgets.map(async (budget) => {
        const spentByCategory = await this.expenseByCategory(userId, budget);
        const parentOf = await this.parentMap([...spentByCategory.keys()]);
        const rolled = rollUpSpending(
          budget.items.map((i) => i.categoryId),
          spentByCategory,
          parentOf,
        );
        const totalSpent = sumMoney(spentByCategory.values());
        const start = toIsoDate(budget.startDate);
        return {
          id: budget.id,
          name: budget.name,
          month: start.slice(0, 7),
          startDate: start,
          endDate: toIsoDate(budget.endDate),
          currency: budget.currency,
          archived: budget.archivedAt !== null,
          totalSpent: toMoneyString(totalSpent),
          overall: budget.overallAmount
            ? utilization(money(budget.overallAmount), totalSpent)
            : null,
          items: budget.items.map((item) => ({
            id: item.id,
            category: item.category,
            ...utilization(money(item.amount), rolled.get(item.categoryId) ?? ZERO),
          })),
        };
      }),
    );
  }

  private async expenseByCategory(
    userId: string,
    budget: BudgetWithItems,
  ): Promise<Map<string, Money>> {
    const rows = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        type: 'EXPENSE',
        status: 'POSTED',
        currency: budget.currency,
        effectiveDate: { gte: budget.startDate, lte: budget.endDate },
      },
      _sum: { amount: true },
    });
    return new Map(rows.map((r) => [r.categoryId, money(r._sum.amount ?? '0')]));
  }

  private async parentMap(categoryIds: string[]): Promise<Map<string, string | null>> {
    if (categoryIds.length === 0) return new Map();
    const rows = await this.prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, parentId: true },
    });
    return new Map(rows.map((r) => [r.id, r.parentId]));
  }
}

function mapDuplicate(error: unknown): unknown {
  const constraint = uniqueViolation(error);
  if (constraint && /budgets_user_period_currency_active/.test(constraint)) {
    return new AppException(
      'CONFLICT',
      'A budget for this month and currency already exists.',
      HttpStatus.CONFLICT,
      [{ field: 'month', message: 'Edit the existing budget instead' }],
    );
  }
  return error;
}
