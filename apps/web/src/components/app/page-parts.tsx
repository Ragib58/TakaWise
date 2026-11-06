'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatMonth, shiftMonth } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { cn } from '@/lib/utils';

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('common.chooseMonth')}>
      <Button
        variant="outline"
        size="icon"
        aria-label={t('common.previousMonth')}
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <span className="min-w-36 text-center font-medium" aria-live="polite">
        {formatMonth(month, locale)}
      </span>
      <Button
        variant="outline"
        size="icon"
        aria-label={t('common.nextMonth')}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );
}

export function LoadingBlock({ className, label }: { className?: string; label?: string }) {
  const t = useT();
  return (
    <div
      role="status"
      aria-label={label ?? t('common.loading')}
      className={cn('animate-pulse rounded-lg bg-secondary', className ?? 'h-32')}
    />
  );
}

export function ErrorBlock({ onRetry }: { onRetry?: () => void }) {
  const t = useT();
  return (
    <Alert>
      {t('common.loadError')}{' '}
      {onRetry ? (
        <button type="button" className="font-medium underline" onClick={onRetry}>
          {t('common.retry')}
        </button>
      ) : null}
    </Alert>
  );
}

/**
 * Signed amount with an explicit sign/word as well as colour, so meaning never
 * relies on colour alone (blueprint §9.4).
 */
export function SignedAmount({
  value,
  formatted,
  className,
}: {
  value: string;
  formatted: string;
  className?: string;
}) {
  const negative = value.trim().startsWith('-');
  const zero = /^-?0(\.0+)?$/.test(value.trim());
  return (
    <span className={cn(zero ? '' : negative ? 'text-destructive' : 'text-positive', className)}>
      {zero || negative ? '' : '+'}
      {formatted}
    </span>
  );
}

export function StatCard({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-xs">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{children}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
