import type { InsightFact } from '@takawise/contracts';
import { type Money, MoneyDecimal, toMoneyString, ZERO } from '../money/money';

/**
 * Backend-computed facts for AI insights (Phase 9, ADR-024). Every number the
 * user sees in an insight is one of these; the model only references them by id.
 */

/** A fact plus what the provider is allowed to see of it. */
export type DomainFact = InsightFact & {
  /** Overrides `value` in the prompt (e.g. a withheld category name). */
  promptValue?: string;
};

const pct = (v: Money) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).toFixed(2);

/** part / whole × 100, or null when whole is zero. */
export function percentOf(part: Money, whole: Money): Money | null {
  return whole.isZero() ? null : part.div(whole).times(100);
}

export class FactSet {
  private readonly facts: DomainFact[] = [];

  money(id: string, value: Money, labelEn: string, labelBn: string): this {
    return this.push({ id, type: 'money', value: toMoneyString(value), labelEn, labelBn });
  }

  percent(id: string, value: Money | null, labelEn: string, labelBn: string): this {
    if (value === null) return this;
    return this.push({ id, type: 'percent', value: pct(value), labelEn, labelBn });
  }

  count(id: string, value: number, labelEn: string, labelBn: string): this {
    return this.push({ id, type: 'count', value: String(value), labelEn, labelBn });
  }

  text(id: string, value: string, labelEn: string, labelBn: string, promptValue?: string): this {
    return this.push({ id, type: 'text', value, labelEn, labelBn, promptValue });
  }

  list(): DomainFact[] {
    return [...this.facts];
  }

  private push(fact: DomainFact): this {
    if (this.facts.some((f) => f.id === fact.id)) throw new Error(`duplicate fact ${fact.id}`);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(fact.id)) throw new Error(`bad fact id ${fact.id}`);
    this.facts.push(fact);
    return this;
  }
}

/** Strips the internal prompt override before facts are returned to the client. */
export function publicFacts(facts: readonly DomainFact[]): InsightFact[] {
  return facts.map(({ promptValue: _ignored, ...fact }) => fact);
}

/** One fact per line, the only numbers the model ever sees. */
export function renderFactsForPrompt(facts: readonly DomainFact[], currency: string): string {
  return facts
    .map((f) => {
      const value = f.promptValue ?? f.value;
      const shown =
        f.type === 'money'
          ? `${value} ${currency}`
          : f.type === 'percent'
            ? `${value}%`
            : f.type === 'text'
              ? JSON.stringify(value)
              : value;
      return `${f.id} | ${f.labelEn} | ${shown}`;
    })
    .join('\n');
}

// ─────────────────────────────── Inputs ───────────────────────────────

export type CategoryAmount = { categoryId: string; name: string; amount: Money };

export type BudgetLine = { name: string; limit: Money; spent: Money; percentUsed: Money };

export type GoalLine = {
  name: string;
  target: Money;
  saved: Money;
  /** Whole months until the target date (≥ 1), or null when there is no date. */
  monthsLeft: number | null;
};

export type MonthTotals = { income: Money; expense: Money; transactionCount: number };

const nameFact = (
  set: FactSet,
  id: string,
  name: string,
  index: number,
  includeNames: boolean,
  en: string,
  bn: string,
) => set.text(id, name, en, bn, includeNames ? undefined : `Category ${index}`);

// ─────────────────────────── Monthly summary ───────────────────────────

export function monthlySummaryFacts(args: {
  current: MonthTotals;
  previous: MonthTotals;
  topCategories: CategoryAmount[];
  budget: BudgetLine | null;
  goals: GoalLine[] | null;
  includeNames: boolean;
}): DomainFact[] {
  const { current, previous } = args;
  const set = new FactSet()
    .money('income', current.income, 'Income this month', 'এই মাসের আয়')
    .money('expense', current.expense, 'Spending this month', 'এই মাসের খরচ')
    .money('net', current.income.minus(current.expense), 'Income minus spending', 'আয় বিয়োগ খরচ')
    .count('transactions', current.transactionCount, 'Recorded transactions', 'লেনদেনের সংখ্যা')
    .percent(
      'savings_rate',
      percentOf(current.income.minus(current.expense), current.income),
      'Share of income not spent',
      'আয়ের যে অংশ খরচ হয়নি',
    )
    .money('prev_income', previous.income, 'Income last month', 'গত মাসের আয়')
    .money('prev_expense', previous.expense, 'Spending last month', 'গত মাসের খরচ')
    .percent(
      'expense_change',
      percentOf(current.expense.minus(previous.expense), previous.expense),
      'Change in spending vs last month (negative = less)',
      'গত মাসের তুলনায় খরচের পরিবর্তন',
    );

  const total = current.expense;
  args.topCategories.slice(0, 3).forEach((c, i) => {
    const n = i + 1;
    nameFact(
      set,
      `cat${n}_name`,
      c.name,
      n,
      args.includeNames,
      `Top category ${n}`,
      `শীর্ষ খাত ${n}`,
    );
    set
      .money(`cat${n}_amount`, c.amount, `Spent in top category ${n}`, `শীর্ষ খাত ${n}-এ খরচ`)
      .percent(
        `cat${n}_share`,
        percentOf(c.amount, total),
        `Share of spending, top category ${n}`,
        `মোট খরচে শীর্ষ খাত ${n}-এর অংশ`,
      );
  });

  if (args.budget) {
    set
      .money('budget_limit', args.budget.limit, 'Monthly budget limit', 'মাসিক বাজেট সীমা')
      .money('budget_spent', args.budget.spent, 'Spent against the budget', 'বাজেটের বিপরীতে খরচ')
      .percent('budget_used', args.budget.percentUsed, 'Budget used', 'বাজেটের ব্যবহৃত অংশ');
  }
  if (args.goals) {
    set.count('goals_open', args.goals.length, 'Open savings goals', 'চলমান সঞ্চয় লক্ষ্য');
    const saved = args.goals.reduce((s, g) => s.plus(g.saved), ZERO);
    const target = args.goals.reduce((s, g) => s.plus(g.target), ZERO);
    if (args.goals.length > 0) {
      set
        .money('goals_saved', saved, 'Saved towards goals', 'লক্ষ্যে জমানো')
        .money('goals_target', target, 'Total of goal targets', 'লক্ষ্যের মোট পরিমাণ');
    }
  }
  return set.list();
}

// ─────────────────────────── Unusual spending ───────────────────────────

export type UnusualCategory = {
  categoryId: string;
  name: string;
  current: Money;
  /** Average of the earlier months considered (zero for new spending). */
  baseline: Money;
  excess: Money;
  /** Null when there was no earlier spending in the category. */
  changePct: Money | null;
  largest: Money;
  count: number;
};

/** A category must exceed its average by this factor … */
export const UNUSUAL_RATIO = '1.5';
/** … and the excess must be at least this share of the month's spending. */
export const UNUSUAL_MIN_SHARE = '0.05';
/** Spending in a category with no history must be at least this share. */
export const NEW_SPENDING_MIN_SHARE = '0.10';
export const MAX_UNUSUAL = 5;

/**
 * Deterministic outlier detection: compares each expense category this month
 * with its average over the earlier months (months with nothing count as zero).
 * Only the flagged categories are sent to the model for explanation.
 */
export function detectUnusualSpending(args: {
  current: ReadonlyArray<{
    categoryId: string;
    name: string;
    current: Money;
    largest: Money;
    count: number;
  }>;
  /** Earlier months, each a map categoryId → amount. Empty months must be included. */
  history: ReadonlyArray<ReadonlyMap<string, Money>>;
  monthTotal: Money;
}): UnusualCategory[] {
  if (args.history.length === 0 || args.monthTotal.isZero()) return [];
  const months = args.history.length;
  const flagged: UnusualCategory[] = [];
  for (const c of args.current) {
    const past = args.history.reduce((s, m) => s.plus(m.get(c.categoryId) ?? ZERO), ZERO);
    const baseline = past.div(months);
    const excess = c.current.minus(baseline);
    const isNew = baseline.isZero();
    const unusual = isNew
      ? c.current.gte(args.monthTotal.times(NEW_SPENDING_MIN_SHARE))
      : c.current.gte(baseline.times(UNUSUAL_RATIO)) &&
        excess.gte(args.monthTotal.times(UNUSUAL_MIN_SHARE));
    if (!unusual) continue;
    flagged.push({
      categoryId: c.categoryId,
      name: c.name,
      current: c.current,
      baseline: baseline.toDecimalPlaces(4, MoneyDecimal.ROUND_HALF_UP),
      excess: excess.toDecimalPlaces(4, MoneyDecimal.ROUND_HALF_UP),
      changePct: percentOf(excess, baseline),
      largest: c.largest,
      count: c.count,
    });
  }
  return flagged.sort((a, b) => b.excess.comparedTo(a.excess)).slice(0, MAX_UNUSUAL);
}

export function unusualSpendingFacts(args: {
  unusual: UnusualCategory[];
  monthTotal: Money;
  monthsCompared: number;
  includeNames: boolean;
}): DomainFact[] {
  const set = new FactSet()
    .money('expense', args.monthTotal, 'Spending this month', 'এই মাসের খরচ')
    .count('months_compared', args.monthsCompared, 'Earlier months compared', 'তুলনা করা আগের মাস');
  args.unusual.forEach((u, i) => {
    const n = i + 1;
    nameFact(
      set,
      `u${n}_name`,
      u.name,
      n,
      args.includeNames,
      `Unusual category ${n}`,
      `অস্বাভাবিক খাত ${n}`,
    );
    set
      .money(`u${n}_amount`, u.current, `Spent this month, category ${n}`, `এই মাসে খরচ, খাত ${n}`)
      .money(
        `u${n}_usual`,
        u.baseline,
        `Usual monthly spending, category ${n}`,
        `স্বাভাবিক মাসিক খরচ, খাত ${n}`,
      )
      .money(
        `u${n}_extra`,
        u.excess,
        `Above usual, category ${n}`,
        `স্বাভাবিকের চেয়ে বেশি, খাত ${n}`,
      )
      .percent(
        `u${n}_change`,
        u.changePct,
        `Change vs usual, category ${n}`,
        `স্বাভাবিকের তুলনায় পরিবর্তন, খাত ${n}`,
      )
      .money(
        `u${n}_largest`,
        u.largest,
        `Largest single expense, category ${n}`,
        `সবচেয়ে বড় একক খরচ, খাত ${n}`,
      )
      .count(`u${n}_count`, u.count, `Number of expenses, category ${n}`, `খরচের সংখ্যা, খাত ${n}`);
    if (u.baseline.isZero()) {
      set.text(
        `u${n}_new`,
        'yes',
        `No spending in category ${n} in earlier months`,
        `আগের মাসগুলোতে খাত ${n}-এ খরচ ছিল না`,
      );
    }
  });
  return set.list();
}

// ───────────────────────── Savings & budget suggestions ─────────────────────────

/** Amount per month needed to reach a goal by its date, or null without a date. */
export function neededPerMonth(goal: GoalLine): Money | null {
  if (goal.monthsLeft === null) return null;
  const remaining = goal.target.minus(goal.saved);
  if (!remaining.greaterThan(0)) return ZERO;
  return remaining
    .div(goal.monthsLeft < 1 ? 1 : goal.monthsLeft)
    .toDecimalPlaces(2, MoneyDecimal.ROUND_UP);
}

export function suggestionFacts(args: {
  current: MonthTotals;
  topCategories: CategoryAmount[];
  /** Null when budgets are excluded from the data scope. */
  budgetLines: BudgetLine[] | null;
  /** Top categories with spending but no budget line (only when a budget exists). */
  unbudgeted: CategoryAmount[];
  goals: GoalLine[] | null;
  includeNames: boolean;
}): DomainFact[] {
  const { current } = args;
  const set = new FactSet()
    .money('income', current.income, 'Income this month', 'এই মাসের আয়')
    .money('expense', current.expense, 'Spending this month', 'এই মাসের খরচ')
    .percent(
      'savings_rate',
      percentOf(current.income.minus(current.expense), current.income),
      'Share of income not spent',
      'আয়ের যে অংশ খরচ হয়নি',
    );
  args.topCategories.slice(0, 3).forEach((c, i) => {
    const n = i + 1;
    nameFact(
      set,
      `cat${n}_name`,
      c.name,
      n,
      args.includeNames,
      `Top category ${n}`,
      `শীর্ষ খাত ${n}`,
    );
    set
      .money(`cat${n}_amount`, c.amount, `Spent in top category ${n}`, `শীর্ষ খাত ${n}-এ খরচ`)
      .percent(
        `cat${n}_share`,
        percentOf(c.amount, current.expense),
        `Share of spending, top category ${n}`,
        `মোট খরচে শীর্ষ খাত ${n}-এর অংশ`,
      );
  });
  if (args.budgetLines) {
    set.count('budget_lines', args.budgetLines.length, 'Budget limits set', 'নির্ধারিত বাজেট সীমা');
    const stretched = args.budgetLines
      .filter((b) => b.percentUsed.gte(80))
      .sort((a, b) => b.percentUsed.comparedTo(a.percentUsed))
      .slice(0, 5);
    stretched.forEach((b, i) => {
      const n = i + 1;
      nameFact(
        set,
        `b${n}_name`,
        b.name,
        n + 10,
        args.includeNames,
        `Budget line ${n} at or over 80%`,
        `৮০% বা বেশি ব্যবহৃত বাজেট ${n}`,
      );
      set
        .money(`b${n}_limit`, b.limit, `Limit, budget line ${n}`, `সীমা, বাজেট ${n}`)
        .money(`b${n}_spent`, b.spent, `Spent, budget line ${n}`, `খরচ, বাজেট ${n}`)
        .percent(`b${n}_used`, b.percentUsed, `Used, budget line ${n}`, `ব্যবহৃত, বাজেট ${n}`);
    });
    args.unbudgeted.slice(0, 3).forEach((c, i) => {
      const n = i + 1;
      nameFact(
        set,
        `nb${n}_name`,
        c.name,
        n + 20,
        args.includeNames,
        `Category ${n} with spending but no budget`,
        `বাজেট ছাড়া খরচের খাত ${n}`,
      );
      set.money(
        `nb${n}_amount`,
        c.amount,
        `Spent, unbudgeted category ${n}`,
        `খরচ, বাজেটহীন খাত ${n}`,
      );
    });
  }
  if (args.goals) {
    set.count('goals_open', args.goals.length, 'Open savings goals', 'চলমান সঞ্চয় লক্ষ্য');
    args.goals
      .filter((g) => g.monthsLeft !== null && g.target.greaterThan(g.saved))
      .slice(0, 3)
      .forEach((g, i) => {
        const n = i + 1;
        // Goal names are user text like category names: withheld with them.
        set.text(
          `g${n}_name`,
          g.name,
          `Goal ${n}`,
          `লক্ষ্য ${n}`,
          args.includeNames ? undefined : `Goal ${n}`,
        );
        set
          .money(
            `g${n}_remaining`,
            g.target.minus(g.saved),
            `Still to save, goal ${n}`,
            `আরও জমাতে হবে, লক্ষ্য ${n}`,
          )
          .count(
            `g${n}_months`,
            g.monthsLeft!,
            `Months until target date, goal ${n}`,
            `লক্ষ্যের তারিখ পর্যন্ত মাস, লক্ষ্য ${n}`,
          )
          .money(
            `g${n}_per_month`,
            neededPerMonth(g)!,
            `Needed per month, goal ${n}`,
            `প্রতি মাসে প্রয়োজন, লক্ষ্য ${n}`,
          );
      });
  }
  return set.list();
}
