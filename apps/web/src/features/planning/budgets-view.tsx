'use client';

import { type BudgetResponse, createBudgetRequestSchema } from '@takawise/contracts';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/components/auth/auth-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProgressBar } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import { currentMonth, formatMoney, formatMonth, shiftMonth } from '@/lib/format';
import { useT } from '@/lib/i18n/use-t';
import { useArchiveBudget, useBudgets, useCategories, useCreateBudget } from './queries';

export function BudgetsView() {
  const session = useSession();
  const t = useT();
  const locale = session.status === 'authenticated' ? session.user.profile.locale : 'en';
  const timezone =
    session.status === 'authenticated' ? session.user.profile.timezone : 'Asia/Dhaka';
  const [month, setMonth] = useState(() => currentMonth(timezone));
  const budgets = useBudgets(month);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('nav.budgets')}</h1>
        <div className="flex items-center gap-1" role="group" aria-label="Choose month">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="min-w-36 text-center font-medium" aria-live="polite">
            {formatMonth(month, locale)}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next month"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>

      {budgets.isPending ? (
        <div
          role="status"
          className="h-40 animate-pulse rounded-lg bg-secondary"
          aria-label="Loading budgets"
        />
      ) : budgets.isError ? (
        <Alert>
          Could not load budgets.{' '}
          <button type="button" className="underline" onClick={() => void budgets.refetch()}>
            Retry
          </button>
        </Alert>
      ) : budgets.data.length === 0 ? (
        <>
          <EmptyState title={`No budget for ${formatMonth(month, locale)}`}>
            Set an overall limit and/or limits per category. Spending is tracked automatically from
            your expenses.
          </EmptyState>
          <CreateBudgetForm month={month} />
        </>
      ) : (
        budgets.data.map((b) => <BudgetCard key={b.id} budget={b} locale={locale} />)
      )}
    </div>
  );
}

function BudgetCard({ budget, locale }: { budget: BudgetResponse; locale: 'en' | 'bn' }) {
  const archive = useArchiveBudget();
  const money = (v: string) => formatMoney(v, budget.currency, locale);
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <CardTitle>{budget.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Spent {money(budget.totalSpent)} · {budget.currency}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={archive.isPending}
          onClick={() => archive.mutate(budget.id)}
        >
          <Trash2 aria-hidden /> Archive
        </Button>
      </div>

      {budget.overall ? (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-sm">
            <span className="font-medium">Overall</span>
            <span>
              {money(budget.overall.spent)} of {money(budget.overall.limit)}
            </span>
          </div>
          <ProgressBar
            label="Overall budget used"
            percent={budget.overall.percentUsed}
            status={budget.overall.status}
          />
        </div>
      ) : null}

      {budget.items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {budget.items.map((item) => {
            const name = locale === 'bn' ? item.category.nameBn : item.category.nameEn;
            const over = item.remaining.startsWith('-');
            return (
              <li key={item.id} className="flex flex-col gap-1">
                <div className="flex justify-between gap-2 text-sm">
                  <span>{name}</span>
                  <span className="text-right">
                    {money(item.spent)} of {money(item.limit)}
                    <span className="block text-xs text-muted-foreground">
                      {over
                        ? `Over by ${money(item.remaining.slice(1))}`
                        : `${money(item.remaining)} left`}
                    </span>
                  </span>
                </div>
                <ProgressBar
                  label={`${name} budget used`}
                  percent={item.percentUsed}
                  status={item.status}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}

type Row = { categoryId: string; amount: string };

function CreateBudgetForm({ month }: { month: string }) {
  const categories = useCategories('EXPENSE');
  const create = useCreateBudget();
  const [overall, setOverall] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = createBudgetRequestSchema.safeParse({
      month,
      ...(overall ? { overallAmount: overall } : {}),
      items: rows.filter((r) => r.categoryId && r.amount),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the form.');
      return;
    }
    setError(null);
    try {
      await create.mutateAsync(parsed.data);
      setOverall('');
      setRows([]);
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.details[0]?.message ?? e.message) : 'Could not save the budget.',
      );
    }
  }

  return (
    <Card>
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
        <CardTitle>Create budget</CardTitle>
        {error ? <Alert>{error}</Alert> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="overall">Overall monthly limit (optional)</Label>
          <Input
            id="overall"
            inputMode="decimal"
            placeholder="e.g. 30000"
            value={overall}
            onChange={(e) => setOverall(e.target.value.trim())}
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Category limits</legend>
          {rows.map((row, index) => (
            <div key={index} className="flex gap-2">
              <Select
                aria-label={`Category ${index + 1}`}
                value={row.categoryId}
                onChange={(e) =>
                  setRows((r) =>
                    r.map((x, i) => (i === index ? { ...x, categoryId: e.target.value } : x)),
                  )
                }
              >
                <option value="">Choose a category</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentId ? '— ' : ''}
                    {c.nameEn} / {c.nameBn}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={`Limit for category ${index + 1}`}
                inputMode="decimal"
                className="w-32"
                value={row.amount}
                onChange={(e) =>
                  setRows((r) =>
                    r.map((x, i) => (i === index ? { ...x, amount: e.target.value.trim() } : x)),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove category"
                onClick={() => setRows((r) => r.filter((_, i) => i !== index))}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setRows((r) => [...r, { categoryId: '', amount: '' }])}
          >
            <Plus aria-hidden /> Add category limit
          </Button>
        </fieldset>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Save budget'}
        </Button>
      </form>
    </Card>
  );
}
