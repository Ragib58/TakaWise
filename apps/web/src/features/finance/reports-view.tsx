'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/app/page-parts';
import { CashFlowChart, CategoryBreakdown } from '@/components/charts/charts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { currentMonth, formatMoney, shiftMonth } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import {
  downloadTransactionsCsv,
  useAccountReport,
  useCashFlow,
  useCategoryReport,
} from './queries';

const RANGES = [3, 6, 12] as const;

/** Last day of a YYYY-MM month (UTC, no time-zone shift). */
const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map((p) => Number.parseInt(p, 10)) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export function ReportsView() {
  const t = useT();
  const { locale, timeZone } = useLocale();
  const [months, setMonths] = useState<(typeof RANGES)[number]>(6);
  const to = currentMonth(timeZone);
  const from = shiftMonth(to, -(months - 1));
  const fromDate = `${from}-01`;
  const toDate = monthEnd(to);

  const cashFlow = useCashFlow(from, to);
  const categories = useCategoryReport(fromDate, toDate);
  const accounts = useAccountReport(fromDate, toDate);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function onExport() {
    setExporting(true);
    setExportError(null);
    try {
      await downloadTransactionsCsv({ from: fromDate, to: toDate });
    } catch {
      setExportError(t('common.saveError'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('reports.title')}
        actions={
          <>
            <Label htmlFor="report-range" className="sr-only">
              {t('reports.range')}
            </Label>
            <Select
              id="report-range"
              className="w-44"
              value={months}
              onChange={(e) => setMonths(Number.parseInt(e.target.value, 10) as typeof months)}
            >
              {RANGES.map((n) => (
                <option key={n} value={n}>
                  {t(`reports.last${n}`)}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => void onExport()}
            >
              <Download aria-hidden /> {exporting ? t('reports.exporting') : t('reports.export')}
            </Button>
          </>
        }
      />
      {exportError ? <Alert>{exportError}</Alert> : null}

      <Card className="flex flex-col gap-3">
        <CardTitle>{t('reports.cashFlow')}</CardTitle>
        {cashFlow.isPending ? (
          <LoadingBlock className="h-64" />
        ) : cashFlow.isError ? (
          <ErrorBlock onRetry={() => void cashFlow.refetch()} />
        ) : (
          <>
            <CashFlowChart months={cashFlow.data.months} currency={cashFlow.data.currency} />
            <dl className="grid grid-cols-3 gap-2 text-sm">
              {(['income', 'expense', 'net'] as const).map((k) => (
                <div key={k}>
                  <dt className="text-muted-foreground">
                    {t(k === 'net' ? 'common.net' : `common.${k}`)}
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {formatMoney(cashFlow.data.totals[k], cashFlow.data.currency, locale)}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <CardTitle>{t('reports.categories')}</CardTitle>
          {categories.isPending ? (
            <LoadingBlock />
          ) : categories.isError ? (
            <ErrorBlock onRetry={() => void categories.refetch()} />
          ) : categories.data.categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('reports.noData')}</p>
          ) : (
            <>
              <CategoryBreakdown
                categories={categories.data.categories}
                currency={categories.data.currency}
              />
              <p className="text-sm">
                {t('reports.total')}:{' '}
                <span className="font-semibold tabular-nums">
                  {formatMoney(categories.data.total, categories.data.currency, locale)}
                </span>
              </p>
            </>
          )}
        </Card>

        <Card className="flex flex-col gap-3 overflow-x-auto">
          <CardTitle>{t('reports.accounts')}</CardTitle>
          {accounts.isPending ? (
            <LoadingBlock />
          ) : accounts.isError ? (
            <ErrorBlock onRetry={() => void accounts.refetch()} />
          ) : accounts.data.accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('reports.noData')}</p>
          ) : (
            <table className="w-full min-w-[28rem] text-sm">
              <caption className="sr-only">{t('reports.accounts')}</caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-2 font-medium">
                    {t('common.account')}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t('reports.opening')}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t('reports.increase')}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t('reports.decrease')}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t('reports.closing')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.data.accounts.map((row) => {
                  const money = (v: string) => formatMoney(v, row.currency, locale);
                  return (
                    <tr key={row.account.id} className="border-b last:border-0">
                      <th scope="row" className="py-2 text-left font-normal">
                        {row.account.name}
                        {row.balanceType === 'LIABILITY' ? (
                          <span className="block text-xs text-muted-foreground">
                            {t('accounts.owed')}
                          </span>
                        ) : null}
                      </th>
                      <td className="py-2 text-right tabular-nums">{money(row.openingBalance)}</td>
                      <td className="py-2 text-right tabular-nums">{money(row.increase)}</td>
                      <td className="py-2 text-right tabular-nums">{money(row.decrease)}</td>
                      <td className="py-2 text-right font-medium tabular-nums">
                        {money(row.closingBalance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
