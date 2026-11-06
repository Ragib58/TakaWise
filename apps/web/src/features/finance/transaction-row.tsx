'use client';

import type { TransactionResponse } from '@takawise/contracts';
import { ArrowDownLeft, ArrowUpRight, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDate, formatMoney } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { cn } from '@/lib/utils';

/** One transaction as a responsive row (cards on mobile, aligned columns on desktop). */
export function TransactionRow({
  trx,
  actions,
}: {
  trx: TransactionResponse;
  actions?: ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const income = trx.type === 'INCOME';
  const reversed = trx.status === 'REVERSED';
  const Icon = reversed ? Undo2 : income ? ArrowDownLeft : ArrowUpRight;
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        aria-hidden
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          reversed
            ? 'bg-secondary text-muted-foreground'
            : income
              ? 'bg-positive/10 text-positive'
              : 'bg-destructive/10 text-destructive',
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-medium', reversed && 'line-through')}>
          {trx.description || (locale === 'bn' ? trx.category.nameBn : trx.category.nameEn)}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {locale === 'bn' ? trx.category.nameBn : trx.category.nameEn} · {trx.account.name} ·{' '}
          {formatDate(trx.effectiveDate, locale)}
          {reversed ? ` · ${t('common.reversed')}` : ''}
        </p>
      </div>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums',
          reversed ? 'text-muted-foreground line-through' : income ? 'text-positive' : '',
        )}
      >
        <span className="sr-only">{income ? t('common.income') : t('common.expense')}: </span>
        {income ? '+' : '−'}
        {formatMoney(trx.amount, trx.currency, locale)}
      </span>
      {actions}
    </li>
  );
}
