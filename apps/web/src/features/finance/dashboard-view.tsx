'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import {
  ErrorBlock,
  LoadingBlock,
  MonthPicker,
  PageHeader,
  SignedAmount,
  StatCard,
} from '@/components/app/page-parts';
import { CategoryBreakdown } from '@/components/charts/charts';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress';
import { currentMonth, formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { useDashboard } from './queries';
import { TransactionRow } from './transaction-row';

export function DashboardView() {
  const t = useT();
  const { locale, timeZone } = useLocale();
  const [month, setMonth] = useState(() => currentMonth(timeZone));
  const dashboard = useDashboard(month);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('dashboard.title')}
        actions={
          <>
            <MonthPicker month={month} onChange={setMonth} />
            <Button asChild size="sm">
              <Link href="/app/transactions/new">
                <Plus aria-hidden /> {t('transactions.add')}
              </Link>
            </Button>
          </>
        }
      />

      {dashboard.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <LoadingBlock key={i} className="h-24" />
          ))}
        </div>
      ) : dashboard.isError ? (
        <ErrorBlock onRetry={() => void dashboard.refetch()} />
      ) : (
        (() => {
          const d = dashboard.data;
          const money = (v: string) => formatMoney(v, d.currency, locale);
          const isEmpty =
            d.recentTransactions.length === 0 &&
            d.assets === '0.0000' &&
            d.liabilities === '0.0000';
          return (
            <>
              {isEmpty ? (
                <Card className="border-brand-teal/40 bg-accent/40">
                  <p className="text-sm">{t('dashboard.getStarted')}</p>
                  <Button asChild size="sm" className="mt-3">
                    <Link href="/app/accounts">{t('accounts.add')}</Link>
                  </Button>
                </Card>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label={t('dashboard.netBalance')}
                  hint={t('dashboard.netBalanceHint', { currency: d.currency })}
                >
                  {money(d.netBalance)}
                </StatCard>
                <StatCard
                  label={t('dashboard.income')}
                  hint={t('dashboard.vsLastMonth', { amount: money(d.previous.income) })}
                >
                  {money(d.income)}
                </StatCard>
                <StatCard
                  label={t('dashboard.expense')}
                  hint={t('dashboard.vsLastMonth', { amount: money(d.previous.expense) })}
                >
                  {money(d.expense)}
                </StatCard>
                <StatCard
                  label={t('dashboard.netCashFlow')}
                  hint={t('dashboard.vsLastMonth', { amount: money(d.previous.netCashFlow) })}
                >
                  <SignedAmount value={d.netCashFlow} formatted={money(d.netCashFlow)} />
                </StatCard>
              </div>

              {d.otherCurrencies.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('dashboard.otherCurrencies', { list: d.otherCurrencies.join(', ') })}
                </p>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="flex flex-col gap-3">
                  <CardTitle>{t('dashboard.topCategories')}</CardTitle>
                  {d.topExpenseCategories.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('dashboard.noSpending')}</p>
                  ) : (
                    <CategoryBreakdown categories={d.topExpenseCategories} currency={d.currency} />
                  )}
                  <Link
                    href="/app/reports"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {t('common.viewAll')}
                  </Link>
                </Card>

                <Card className="flex flex-col gap-3">
                  <CardTitle>{t('dashboard.budget')}</CardTitle>
                  {d.budget ? (
                    <>
                      {d.budget.overall ? (
                        <>
                          <div className="flex justify-between text-sm">
                            <span>{d.budget.name}</span>
                            <span className="tabular-nums">
                              {money(d.budget.overall.spent)} / {money(d.budget.overall.limit)}
                            </span>
                          </div>
                          <ProgressBar
                            label={d.budget.name}
                            percent={d.budget.overall.percentUsed}
                            status={d.budget.overall.status}
                          />
                        </>
                      ) : null}
                      {d.budget.itemsOver > 0 ? (
                        <p className="text-sm text-destructive">
                          {t('dashboard.itemsOver', { count: d.budget.itemsOver })}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('dashboard.noBudget')}</p>
                  )}
                  <Link
                    href="/app/budgets"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {d.budget ? t('common.viewAll') : t('dashboard.createBudget')}
                  </Link>
                </Card>

                <Card className="flex flex-col gap-3">
                  <CardTitle>{t('dashboard.goals')}</CardTitle>
                  {d.goals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('dashboard.noGoals')}</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {d.goals.map((g) => (
                        <li key={g.id} className="flex flex-col gap-1">
                          <div className="flex justify-between text-sm">
                            <span>{g.name}</span>
                            <span className="tabular-nums">
                              {money(g.saved)} / {money(g.targetAmount)}
                            </span>
                          </div>
                          <ProgressBar label={g.name} percent={g.percent} showStatus={false} />
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link
                    href="/app/goals"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {t('common.viewAll')}
                  </Link>
                </Card>

                <Card className="flex flex-col gap-3">
                  <CardTitle>{t('dashboard.reminders')}</CardTitle>
                  {d.upcomingReminders.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('dashboard.noReminders')}</p>
                  ) : (
                    <ul className="flex flex-col gap-2 text-sm">
                      {d.upcomingReminders.map((r) => (
                        <li key={r.id} className="flex justify-between gap-2">
                          <span>{r.title}</span>
                          <span className="text-muted-foreground">
                            {formatDateTime(r.dueAt, r.timezone, locale)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link
                    href="/app/reminders"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {t('common.viewAll')}
                  </Link>
                </Card>
              </div>

              <Card className="flex flex-col gap-2">
                <CardTitle>{t('dashboard.recent')}</CardTitle>
                {d.recentTransactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('dashboard.noTransactions')}</p>
                ) : (
                  <ul className="divide-y">
                    {d.recentTransactions.map((trx) => (
                      <TransactionRow key={trx.id} trx={trx} />
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  {formatDate(d.startDate, locale)} – {formatDate(d.endDate, locale)}
                </p>
              </Card>
            </>
          );
        })()
      )}
    </div>
  );
}
