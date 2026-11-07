'use client';

import type { ValueBasis } from '@takawise/contracts';
import { Info } from 'lucide-react';
import { type ComponentProps, type ReactNode, useCallback, useId, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { cn } from '@/lib/utils';

/** Shared pieces for the Phase 8 wealth screens. */

export const errorText = (e: unknown, fallback: string) =>
  e instanceof ApiError ? (e.details[0]?.message ?? e.message) : fallback;

/** One Idempotency-Key per attempt; renewed after success or a client error (ADR-006). */
export function useAttemptKey(): [string, () => void] {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return [key, useCallback(() => setKey(crypto.randomUUID()), [])];
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const nowLocalInput = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
/** `datetime-local` value → ISO instant with offset (the API requires one). */
export const toInstant = (local: string) => new Date(local).toISOString();

/**
 * How a value was obtained, always shown next to the figure (Phase 8 rule:
 * label user-entered, estimated and verified values clearly).
 */
export function BasisBadge({ basis, valuedOn }: { basis: ValueBasis; valuedOn?: string | null }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        basis === 'RECORDED'
          ? 'bg-secondary'
          : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
      )}
    >
      {t(`wealth.basis.${basis}`)}
      {valuedOn ? ` · ${t('wealth.valuedOn', { date: formatDate(valuedOn, locale) })}` : ''}
    </span>
  );
}

export function Disclaimer({ children }: { children?: ReactNode }) {
  const t = useT();
  return (
    <p className="flex items-start gap-2 rounded-md border bg-secondary/40 p-3 text-xs text-muted-foreground">
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {t('wealth.disclaimer')} {children}
      </span>
    </p>
  );
}

export function SelectField({
  label,
  children,
  ...props
}: ComponentProps<typeof Select> & { label: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} {...props}>
        {children}
      </Select>
    </div>
  );
}
