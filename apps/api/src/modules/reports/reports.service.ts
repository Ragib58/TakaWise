import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AccountReportResponse,
  type CashFlowResponse,
  type CategoryReportResponse,
  type CategoryTotal,
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  type DashboardQuery,
  type DashboardResponse,
  MAX_REPORT_DAYS,
  MAX_REPORT_MONTHS,
} from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import { money, type Money, toMoneyString, ZERO } from '../../domain/money/money';
import { monthRange } from '../../domain/planning/budget-math';
import { daysBetween, monthsBetween, previousMonth } from '../../domain/reports/periods';
import { localDateOf } from '../../domain/time/local-date';
import { PrismaService } from '../../database/prisma.service';
import { BudgetsService } from '../budgets/budgets.service';
import { GoalsService } from '../goals/goals.service';
import { LedgerService } from '../ledger/ledger.service';
import { RemindersService } from '../reminders/reminders.service';
import { TransactionsService } from '../transactions/transactions.service';

const invalid = (field: string, message: string) =>
  new AppException(
    'VALIDATION_ERROR',
    'Please check the submitted fields.',
    HttpStatus.BAD_REQUEST,
    [{ field, message }],
  );

const percent = (part: Money, whole: Money) =>
  (whole.isZero() ? ZERO : part.div(whole).times(100)).toFixed(2);

/**
 * DASH-01 / REP-01. Reads only POSTED transactions (status REVERSED is
 * excluded, transfers are never transactions) and posted journal lines, so every
 * figure reconciles with the ledger. Totals are grouped by currency and never
 * summed across currencies (ADR-016).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly budgets: BudgetsService,
    private readonly goals: GoalsService,
    private readonly reminders: RemindersService,
    private readonly transactions: TransactionsService,
  ) {}

  async preferences(userId: string): Promise<{ timeZone: string; currency: string }> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true, defaultCurrency: true },
    });
    return {
      timeZone: profile?.timezone ?? DEFAULT_TIMEZONE,
      currency: profile?.defaultCurrency ?? DEFAULT_CURRENCY,
    };
  }

  // ─────────────────────────────── Cash flow ───────────────────────────────

  async cashFlow(
    userId: string,
    from: string,
    to: string,
    currency?: string,
  ): Promise<CashFlowResponse> {
    const months = monthsBetween(from, to);
    if (months.length > MAX_REPORT_MONTHS) {
      throw invalid('to', `Choose at most ${MAX_REPORT_MONTHS} months`);
    }
    const cur = currency ?? (await this.preferences(userId)).currency;
    const start = monthRange(from).start;
    const end = monthRange(to).end;

    const rows = await this.prisma.$queryRaw<
      Array<{ month: string; type: 'INCOME' | 'EXPENSE'; total: string }>
    >`
      SELECT to_char("effective_date", 'YYYY-MM') AS "month", "type"::text AS "type", SUM("amount")::text AS "total"
        FROM "transactions"
       WHERE "user_id" = ${userId}::uuid
         AND "status" = 'POSTED'
         AND "currency" = ${cur}
         AND "effective_date" BETWEEN ${start}::date AND ${end}::date
       GROUP BY 1, 2`;

    let totalIncome = ZERO;
    let totalExpense = ZERO;
    const points = months.map((month) => {
      const income = money(
        rows.find((r) => r.month === month && r.type === 'INCOME')?.total ?? '0',
      );
      const expense = money(
        rows.find((r) => r.month === month && r.type === 'EXPENSE')?.total ?? '0',
      );
      totalIncome = totalIncome.plus(income);
      totalExpense = totalExpense.plus(expense);
      return {
        month,
        income: toMoneyString(income),
        expense: toMoneyString(expense),
        net: toMoneyString(income.minus(expense)),
      };
    });
    return {
      currency: cur,
      months: points,
      totals: {
        income: toMoneyString(totalIncome),
        expense: toMoneyString(totalExpense),
        net: toMoneyString(totalIncome.minus(totalExpense)),
      },
    };
  }

  // ─────────────────────────────── Categories ───────────────────────────────

  async categories(
    userId: string,
    args: { from: string; to: string; type: 'INCOME' | 'EXPENSE'; currency?: string },
  ): Promise<CategoryReportResponse> {
    if (daysBetween(args.from, args.to) > MAX_REPORT_DAYS) {
      throw invalid('to', `Choose a range of at most ${MAX_REPORT_DAYS} days`);
    }
    const currency = args.currency ?? (await this.preferences(userId)).currency;
    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        type: args.type,
        status: 'POSTED',
        currency,
        effectiveDate: {
          gte: new Date(`${args.from}T00:00:00Z`),
          lte: new Date(`${args.to}T00:00:00Z`),
        },
      },
      _sum: { amount: true },
    });
    const categories = await this.prisma.category.findMany({
      where: { id: { in: grouped.map((g) => g.categoryId) } },
      select: { id: true, nameEn: true, nameBn: true, parentId: true },
    });
    const total = grouped.reduce((sum, g) => sum.plus(money(g._sum.amount ?? '0')), ZERO);
    const rows: CategoryTotal[] = grouped
      .map((g) => {
        const amount = money(g._sum.amount ?? '0');
        const category = categories.find((c) => c.id === g.categoryId)!;
        return { ...category, amount };
      })
      .sort((a, b) => b.amount.comparedTo(a.amount))
      .map(({ amount, ...category }) => ({
        ...category,
        total: toMoneyString(amount),
        share: percent(amount, total),
      }));
    return {
      currency,
      type: args.type,
      from: args.from,
      to: args.to,
      total: toMoneyString(total),
      categories: rows,
    };
  }

  // ──────────────────────────────── Accounts ────────────────────────────────

  /** Opening/closing balances and movements per account, straight from journal lines. */
  async accounts(userId: string, from: string, to: string): Promise<AccountReportResponse> {
    if (daysBetween(from, to) > MAX_REPORT_DAYS) {
      throw invalid('to', `Choose a range of at most ${MAX_REPORT_DAYS} days`);
    }
    const accounts = await this.prisma.financialAccount.findMany({
      where: { userId },
      include: { ledgerAccount: { select: { id: true, normalBalance: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    const sums = await this.prisma.$queryRaw<
      Array<{ id: string; od: string; oc: string; pd: string; pc: string }>
    >`
      SELECT l."ledger_account_id" AS "id",
             COALESCE(SUM(CASE WHEN e."effective_date" < ${from}::date THEN l."debit" END), 0)::text AS "od",
             COALESCE(SUM(CASE WHEN e."effective_date" < ${from}::date THEN l."credit" END), 0)::text AS "oc",
             COALESCE(SUM(CASE WHEN e."effective_date" >= ${from}::date THEN l."debit" END), 0)::text AS "pd",
             COALESCE(SUM(CASE WHEN e."effective_date" >= ${from}::date THEN l."credit" END), 0)::text AS "pc"
        FROM "journal_lines" l
        JOIN "journal_entries" e ON e."id" = l."journal_entry_id"
       WHERE e."user_id" = ${userId}::uuid
         AND e."effective_date" <= ${to}::date
       GROUP BY l."ledger_account_id"`;

    return {
      from,
      to,
      accounts: accounts.flatMap((account) => {
        if (!account.ledgerAccount) return [];
        const row = sums.find((s) => s.id === account.ledgerAccount!.id);
        const [od, oc, pd, pc] = [row?.od, row?.oc, row?.pd, row?.pc].map((v) =>
          money(v ?? '0'),
        ) as [Money, Money, Money, Money];
        const debitNormal = account.ledgerAccount.normalBalance === 'DEBIT';
        const opening = debitNormal ? od.minus(oc) : oc.minus(od);
        const increase = debitNormal ? pd : pc;
        const decrease = debitNormal ? pc : pd;
        return [
          {
            account: {
              id: account.id,
              name: account.name,
              type: account.type,
              status: account.status,
            },
            currency: account.currency,
            balanceType: debitNormal ? ('ASSET' as const) : ('LIABILITY' as const),
            openingBalance: toMoneyString(opening),
            increase: toMoneyString(increase),
            decrease: toMoneyString(decrease),
            closingBalance: toMoneyString(opening.plus(increase).minus(decrease)),
          },
        ];
      }),
    };
  }

  // ──────────────────────────────── Dashboard ────────────────────────────────

  async dashboard(userId: string, query: DashboardQuery): Promise<DashboardResponse> {
    const prefs = await this.preferences(userId);
    const currency = query.currency ?? prefs.currency;
    const month = query.month ?? localDateOf(new Date(), prefs.timeZone).slice(0, 7);
    const prev = previousMonth(month);
    const { start, end } = monthRange(month);

    const accounts = await this.prisma.financialAccount.findMany({
      where: { userId },
      include: { ledgerAccount: { select: { id: true, normalBalance: true } } },
    });
    const inCurrency = accounts.filter((a) => a.currency === currency && a.ledgerAccount);
    const balances = await this.ledger.balances(
      this.prisma,
      inCurrency.map((a) => a.ledgerAccount!),
    );
    let assets = ZERO;
    let liabilities = ZERO;
    for (const a of inCurrency) {
      const balance = balances.get(a.ledgerAccount!.id) ?? ZERO;
      if (a.ledgerAccount!.normalBalance === 'DEBIT') assets = assets.plus(balance);
      else liabilities = liabilities.plus(balance);
    }

    const [flow, categories, budgets, goals, recent, reminders] = await Promise.all([
      this.cashFlow(userId, prev, month, currency),
      this.categories(userId, { from: start, to: end, type: 'EXPENSE', currency }),
      this.budgets.list(userId, { month, status: 'ACTIVE' }),
      this.goals.list(userId, 'OPEN'),
      this.transactions.list(userId, { page: 1, pageSize: 5 }),
      this.reminders.list(userId, { page: 1, pageSize: 3, view: 'upcoming' }),
    ]);
    const [previous, current] = flow.months as [
      CashFlowResponse['months'][number],
      CashFlowResponse['months'][number],
    ];
    const budget = budgets.find((b) => b.currency === currency) ?? null;

    return {
      month,
      startDate: start,
      endDate: end,
      currency,
      otherCurrencies: [
        ...new Set(accounts.map((a) => a.currency).filter((c) => c !== currency)),
      ].sort(),
      netBalance: toMoneyString(assets.minus(liabilities)),
      assets: toMoneyString(assets),
      liabilities: toMoneyString(liabilities),
      income: current.income,
      expense: current.expense,
      netCashFlow: current.net,
      previous: {
        month: prev,
        income: previous.income,
        expense: previous.expense,
        netCashFlow: previous.net,
      },
      topExpenseCategories: categories.categories.slice(0, 5),
      budget: budget
        ? {
            id: budget.id,
            name: budget.name,
            overall: budget.overall,
            itemsOver: budget.items.filter((i) => i.status === 'over').length,
            itemsWarning: budget.items.filter((i) => i.status === 'warning').length,
          }
        : null,
      goals: goals
        .filter((g) => g.currency === currency)
        .slice(0, 3)
        .map((g) => ({
          id: g.id,
          name: g.name,
          saved: g.saved,
          targetAmount: g.targetAmount,
          percent: g.percent,
          status: g.status,
        })),
      recentTransactions: recent.items,
      upcomingReminders: reminders.items,
    };
  }
}
