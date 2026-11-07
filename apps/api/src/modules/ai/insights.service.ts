import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AiDataScope,
  type InsightKind,
  type InsightLimitation,
  type InsightResponse,
  insightRequestSchema,
  type Locale,
  type NarrativeSegment,
} from '@takawise/contracts';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import {
  type CategoryAmount,
  type DomainFact,
  detectUnusualSpending,
  type GoalLine,
  type MonthTotals,
  monthlySummaryFacts,
  publicFacts,
  renderFactsForPrompt,
  suggestionFacts,
  unusualSpendingFacts,
} from '../../domain/ai/facts';
import { NarrativeInvalidError, validateInsightNarrative } from '../../domain/ai/narrative';
import { cleanText, redactIdentifiers } from '../../domain/ai/redact';
import { money, type Money } from '../../domain/money/money';
import { monthRange } from '../../domain/planning/budget-math';
import { monthsBetween, previousMonth } from '../../domain/reports/periods';
import { localDateOf } from '../../domain/time/local-date';
import { PrismaService } from '../../database/prisma.service';
import { BudgetsService } from '../budgets/budgets.service';
import { GoalsService } from '../goals/goals.service';
import { ReportsService } from '../reports/reports.service';
import { AiAnswerRejected, AiService } from './ai.service';
import { insightSystemPrompt, insightUserPrompt, llmInsightSchema } from './prompts';

type InsightInput = z.output<typeof insightRequestSchema>;

/** Bump when prompts or fact builders change, so stored insights are regenerated. */
const PROMPT_VERSION = 'insight-v1';
const MAX_MONTHS_BACK = 24;
const HISTORY_MONTHS = 3;

type Computed = {
  facts: DomainFact[];
  status: InsightResponse['status'];
  limitations: InsightLimitation[];
};

/**
 * AI-01: the backend computes the facts for one month and currency; the model
 * only explains them (ADR-024). Insights are cached per facts hash.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly reports: ReportsService,
    private readonly budgets: BudgetsService,
    private readonly goals: GoalsService,
  ) {}

  async generate(userId: string, input: InsightInput): Promise<InsightResponse> {
    await this.ai.assertAllowed(userId, input.kind);

    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true, defaultCurrency: true, locale: true },
    });
    const timeZone = profile?.timezone ?? 'Asia/Dhaka';
    const currency = input.currency ?? profile?.defaultCurrency ?? 'BDT';
    const locale: Locale = input.locale ?? (profile?.locale === 'BN' ? 'bn' : 'en');
    const today = localDateOf(new Date(), timeZone);
    const thisMonth = today.slice(0, 7);
    if (input.month > thisMonth || monthsBetween(input.month, thisMonth).length > MAX_MONTHS_BACK) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Please check the submitted fields.',
        HttpStatus.BAD_REQUEST,
        [{ field: 'month', message: `Choose a month within the last ${MAX_MONTHS_BACK} months` }],
      );
    }
    const scope: AiDataScope[] = [...new Set(input.include)].sort();
    const { start, end } = monthRange(input.month);
    const monthInProgress = input.month === thisMonth;

    const computed = await this.compute(
      userId,
      input.kind,
      input.month,
      currency,
      locale,
      scope,
      today,
    );
    const limitations: InsightLimitation[] = [
      'RECORDED_DATA_ONLY',
      'SINGLE_CURRENCY',
      ...(monthInProgress ? (['MONTH_IN_PROGRESS'] as const) : []),
      ...(scope.includes('CATEGORY_NAMES') ? [] : (['CATEGORY_NAMES_WITHHELD'] as const)),
      ...computed.limitations,
    ];
    const base = {
      kind: input.kind,
      month: input.month,
      periodStart: start,
      periodEnd: end,
      currency,
      locale,
      dataScope: scope,
      facts: publicFacts(computed.facts),
      limitations,
    };
    if (computed.status !== 'READY') {
      // Nothing worth explaining: the provider is not called at all.
      return {
        ...base,
        status: computed.status,
        cached: false,
        generatedAt: null,
        model: null,
        headline: [],
        points: [],
      };
    }

    const factsHash = createHash('sha256')
      .update(
        JSON.stringify({
          v: PROMPT_VERSION,
          kind: input.kind,
          locale,
          scope,
          facts: computed.facts,
        }),
      )
      .digest('hex');
    const key = {
      userId,
      kind: input.kind,
      month: input.month,
      currency,
      locale: locale === 'bn' ? ('BN' as const) : ('EN' as const),
    };
    const stored = await this.prisma.aiInsight.findUnique({
      where: { userId_kind_month_currency_locale: key },
    });
    if (stored && stored.factsHash === factsHash && !input.refresh) {
      const content = stored.content as {
        headline: NarrativeSegment[];
        points: NarrativeSegment[][];
      };
      return {
        ...base,
        status: 'READY',
        cached: true,
        generatedAt: stored.createdAt.toISOString(),
        model: stored.model,
        headline: content.headline,
        points: content.points,
      };
    }

    const factIds = new Set(computed.facts.map((f) => f.id));
    const { result, model } = await this.ai.invoke(
      userId,
      {
        feature: input.kind,
        system: insightSystemPrompt(input.kind, locale),
        content: [
          {
            type: 'text',
            text: insightUserPrompt({
              month: input.month,
              monthInProgress,
              currency,
              factsText: renderFactsForPrompt(computed.facts, currency),
            }),
          },
        ],
        schema: llmInsightSchema,
        effort: 'medium',
        maxOutputTokens: 16_000,
      },
      (output) => {
        try {
          return validateInsightNarrative(output, factIds);
        } catch (error) {
          if (error instanceof NarrativeInvalidError) throw new AiAnswerRejected(error.reason);
          throw error;
        }
      },
    );
    const content = { headline: result.headline, points: result.points };
    const saved = await this.prisma.aiInsight.upsert({
      where: { userId_kind_month_currency_locale: key },
      create: { ...key, factsHash, content, model },
      update: { factsHash, content, model, createdAt: new Date() },
    });
    return {
      ...base,
      status: 'READY',
      cached: false,
      generatedAt: saved.createdAt.toISOString(),
      model,
      headline: result.headline,
      points: result.points,
    };
  }

  // ───────────────────────────── Facts ─────────────────────────────

  private async compute(
    userId: string,
    kind: InsightKind,
    month: string,
    currency: string,
    locale: Locale,
    scope: AiDataScope[],
    today: string,
  ): Promise<Computed> {
    const includeNames = scope.includes('CATEGORY_NAMES');
    const { start, end } = monthRange(month);
    const flow = await this.reports.cashFlow(userId, previousMonth(month), month, currency);
    const [prevFlow, curFlow] = flow.months as [
      (typeof flow.months)[number],
      (typeof flow.months)[number],
    ];
    const transactionCount = await this.prisma.transaction.count({
      where: {
        userId,
        status: 'POSTED',
        currency,
        effectiveDate: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) },
      },
    });
    if (transactionCount === 0) return { facts: [], status: 'NO_DATA', limitations: [] };

    const current: MonthTotals = {
      income: money(curFlow.income),
      expense: money(curFlow.expense),
      transactionCount,
    };
    const previous: MonthTotals = {
      income: money(prevFlow.income),
      expense: money(prevFlow.expense),
      transactionCount: 0,
    };
    const label = (c: { nameEn: string; nameBn: string }) =>
      cleanText(redactIdentifiers(locale === 'bn' ? c.nameBn : c.nameEn), 60);

    const categoryReport = await this.reports.categories(userId, {
      from: start,
      to: end,
      type: 'EXPENSE',
      currency,
    });
    const topCategories: CategoryAmount[] = categoryReport.categories.map((c) => ({
      categoryId: c.id,
      name: label(c),
      amount: money(c.total),
    }));

    if (kind === 'UNUSUAL_SPENDING') {
      return this.unusual(userId, month, currency, current.expense, includeNames, label);
    }

    const goals = scope.includes('GOALS') ? await this.goalLines(userId, currency, today) : null;
    const budget = scope.includes('BUDGETS')
      ? ((await this.budgets.list(userId, { month, status: 'ACTIVE' })).find(
          (b) => b.currency === currency,
        ) ?? null)
      : null;

    if (kind === 'MONTHLY_SUMMARY') {
      const facts = monthlySummaryFacts({
        current,
        previous,
        topCategories,
        budget: budget?.overall
          ? {
              name: budget.name,
              limit: money(budget.overall.limit),
              spent: money(budget.overall.spent),
              percentUsed: money(budget.overall.percentUsed),
            }
          : null,
        goals,
        includeNames,
      });
      return { facts, status: 'READY', limitations: [] };
    }

    // SAVINGS_SUGGESTIONS
    const budgetLines = scope.includes('BUDGETS')
      ? (budget?.items ?? []).map((i) => ({
          name: label(i.category),
          limit: money(i.limit),
          spent: money(i.spent),
          percentUsed: money(i.percentUsed),
        }))
      : null;
    const budgeted = new Set((budget?.items ?? []).map((i) => i.category.id));
    const unbudgeted = budget ? topCategories.filter((c) => !budgeted.has(c.categoryId)) : [];
    const facts = suggestionFacts({
      current,
      topCategories,
      budgetLines,
      unbudgeted,
      goals,
      includeNames,
    });
    return { facts, status: 'READY', limitations: [] };
  }

  private async unusual(
    userId: string,
    month: string,
    currency: string,
    monthTotal: Money,
    includeNames: boolean,
    label: (c: { nameEn: string; nameBn: string }) => string,
  ): Promise<Computed> {
    // Earlier months only count from the first month with any posted transaction,
    // so a new user's empty past is not mistaken for "usual = zero".
    const first = await this.prisma.transaction.aggregate({
      where: { userId, status: 'POSTED', currency },
      _min: { effectiveDate: true },
    });
    const firstMonth = first._min.effectiveDate?.toISOString().slice(0, 7) ?? month;
    const earlier: string[] = [];
    for (
      let m = previousMonth(month);
      earlier.length < HISTORY_MONTHS && m >= firstMonth;
      m = previousMonth(m)
    ) {
      earlier.push(m);
    }
    const limitations: InsightLimitation[] =
      earlier.length < HISTORY_MONTHS ? ['SHORT_HISTORY'] : [];
    if (earlier.length === 0) return { facts: [], status: 'NOTHING_UNUSUAL', limitations };

    const from = monthRange(earlier[earlier.length - 1]!).start;
    const to = monthRange(month).end;
    const rows = await this.prisma.$queryRaw<
      Array<{ category_id: string; month: string; total: string; largest: string; count: number }>
    >`
      SELECT "category_id", to_char("effective_date", 'YYYY-MM') AS "month",
             SUM("amount")::text AS "total", MAX("amount")::text AS "largest", COUNT(*)::int AS "count"
        FROM "transactions"
       WHERE "user_id" = ${userId}::uuid
         AND "type" = 'EXPENSE'
         AND "status" = 'POSTED'
         AND "currency" = ${currency}
         AND "effective_date" BETWEEN ${from}::date AND ${to}::date
       GROUP BY 1, 2`;
    const categories = await this.prisma.category.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.category_id))] } },
      select: { id: true, nameEn: true, nameBn: true },
    });
    const nameOf = new Map(categories.map((c) => [c.id, label(c)]));
    const current = rows
      .filter((r) => r.month === month)
      .map((r) => ({
        categoryId: r.category_id,
        name: nameOf.get(r.category_id) ?? '',
        current: money(r.total),
        largest: money(r.largest),
        count: r.count,
      }));
    const history = earlier.map(
      (m) => new Map(rows.filter((r) => r.month === m).map((r) => [r.category_id, money(r.total)])),
    );
    const unusual = detectUnusualSpending({ current, history, monthTotal });
    if (unusual.length === 0) return { facts: [], status: 'NOTHING_UNUSUAL', limitations };
    return {
      facts: unusualSpendingFacts({
        unusual,
        monthTotal,
        monthsCompared: earlier.length,
        includeNames,
      }),
      status: 'READY',
      limitations,
    };
  }

  private async goalLines(userId: string, currency: string, today: string): Promise<GoalLine[]> {
    const goals = await this.goals.list(userId, 'OPEN');
    const thisMonth = today.slice(0, 7);
    return goals
      .filter((g) => g.currency === currency && g.status === 'ACTIVE')
      .map((g) => {
        const target = g.targetDate?.slice(0, 7) ?? null;
        const monthsLeft =
          target === null
            ? null
            : target <= thisMonth
              ? 1
              : monthsBetween(thisMonth, target).length;
        return {
          name: cleanText(redactIdentifiers(g.name), 60),
          target: money(g.targetAmount),
          saved: money(g.saved),
          monthsLeft,
        };
      });
  }
}
