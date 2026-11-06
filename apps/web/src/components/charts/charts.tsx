'use client';

import type { CashFlowPoint, CategoryTotal } from '@takawise/contracts';
import { BarChart3, Table2 } from 'lucide-react';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { formatMoney, formatMonth } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';

/** Recharts needs numbers; this is display-only and never feeds back into money maths. */
const toChartNumber = (amount: string) => Number.parseFloat(amount);

function ViewToggle({ table, onToggle }: { table: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <Button variant="ghost" size="sm" onClick={onToggle} aria-pressed={table}>
      {table ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />}
      {table ? t('common.showChart') : t('common.showTable')}
    </Button>
  );
}

/**
 * Income vs expense per month. The chart is hidden from screen readers; the
 * same numbers are always available as a real table (toggle or sr-only).
 */
export function CashFlowChart({ months, currency }: { months: CashFlowPoint[]; currency: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [table, setTable] = useState(false);
  const money = (v: string) => formatMoney(v, currency, locale);
  const data = months.map((m) => ({
    label: formatMonth(m.month, locale),
    income: toChartNumber(m.income),
    expense: toChartNumber(m.expense),
  }));

  const tableView = (
    <table className="w-full text-sm">
      <caption className="sr-only">{t('reports.cashFlow')}</caption>
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th scope="col" className="py-2 font-medium">
            {t('common.month')}
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            {t('common.income')}
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            {t('common.expense')}
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            {t('common.net')}
          </th>
        </tr>
      </thead>
      <tbody>
        {months.map((m) => (
          <tr key={m.month} className="border-b last:border-0">
            <th scope="row" className="py-2 text-left font-normal">
              {formatMonth(m.month, locale)}
            </th>
            <td className="py-2 text-right tabular-nums">{money(m.income)}</td>
            <td className="py-2 text-right tabular-nums">{money(m.expense)}</td>
            <td className="py-2 text-right tabular-nums">{money(m.net)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <ViewToggle table={table} onToggle={() => setTable((v) => !v)} />
      </div>
      {table ? (
        tableView
      ) : (
        <>
          <div className="h-64 w-full" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  width={70}
                  tickFormatter={(v: number) =>
                    new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
                      notation: 'compact',
                    }).format(v)
                  }
                />
                <Tooltip formatter={(value) => money(String(value))} />
                <Legend />
                <Bar
                  dataKey="income"
                  name={t('common.income')}
                  fill="var(--color-positive)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="expense"
                  name={t('common.expense')}
                  fill="var(--color-destructive)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="sr-only">{tableView}</div>
        </>
      )}
    </div>
  );
}

/** Ranked category totals with share bars (text + bar, accessible list). */
export function CategoryBreakdown({
  categories,
  currency,
  limit,
}: {
  categories: CategoryTotal[];
  currency: string;
  limit?: number;
}) {
  const { locale } = useLocale();
  const rows = limit ? categories.slice(0, limit) : categories;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((c) => {
        const name = locale === 'bn' ? c.nameBn : c.nameEn;
        return (
          <li key={c.id} className="flex flex-col gap-1">
            <div className="flex justify-between gap-2 text-sm">
              <span>{name}</span>
              <span className="tabular-nums">
                {formatMoney(c.total, currency, locale)}{' '}
                <span className="text-muted-foreground">· {c.share}%</span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
              <div
                className="h-full rounded-full bg-brand-teal"
                style={{ width: `${Math.min(100, toChartNumber(c.share))}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
