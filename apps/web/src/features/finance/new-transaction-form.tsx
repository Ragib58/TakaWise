'use client';

import { moneyAmountSchema } from '@takawise/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader } from '@/components/app/page-parts';
import { FormField } from '@/components/forms/form-field';
import { useApiFormError } from '@/components/forms/use-api-form-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatMoney } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { cn } from '@/lib/utils';
import { useCategories } from '../planning/queries';
import { useAccountList, useCreateTransaction } from './queries';

/** Form shape (datetime-local + selects); converted to the API contract on submit. */
const formSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']),
  accountId: z.string().min(1, 'Choose an account'),
  categoryId: z.string().min(1, 'Choose a category'),
  amount: moneyAmountSchema,
  occurredAt: z.string().min(1, 'Choose a date and time'),
  description: z.string().trim().max(500).optional(),
});
type FormValues = z.infer<typeof formSchema>;

/** Local "YYYY-MM-DDTHH:mm" for a datetime-local default. */
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** Values a reviewed AI draft (Phase 9) pre-fills; the user still confirms every field. */
export type TransactionPrefill = {
  type?: 'INCOME' | 'EXPENSE' | null;
  amount?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  /** YYYY-MM-DD; noon local time is used. */
  occurredOn?: string | null;
  description?: string | null;
};

export function NewTransactionForm({
  initial,
  embedded = false,
  onSaved,
}: {
  initial?: TransactionPrefill;
  /** Inside another page: no page header or navigation buttons. */
  embedded?: boolean;
  onSaved?: () => void;
} = {}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const accounts = useAccountList('ACTIVE');
  const categories = useCategories();
  const create = useCreateTransaction();
  // One key per attempt (ADR-006): a retry after a network error cannot double-post.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [saved, setSaved] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: initial?.type ?? 'EXPENSE',
      accountId: initial?.accountId ?? '',
      categoryId: initial?.categoryId ?? '',
      amount: initial?.amount ?? '',
      occurredAt: initial?.occurredOn ? `${initial.occurredOn}T12:00` : nowLocal(),
      description: initial?.description ?? '',
    },
  });
  const { formError, handle } = useApiFormError(form.setError);
  const { errors, isSubmitting } = form.formState;
  const type = form.watch('type');
  const accountId = form.watch('accountId');
  const account = accounts.data?.find((a) => a.id === accountId);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaved(null);
    try {
      const result = await create.mutateAsync({
        key,
        body: {
          type: values.type,
          accountId: values.accountId,
          categoryId: values.categoryId,
          amount: values.amount,
          currency: account?.currency ?? 'BDT',
          occurredAt: new Date(values.occurredAt).toISOString(),
          ...(values.description ? { description: values.description } : {}),
        },
      });
      setSaved(
        t('transactions.saved', {
          account: result.account.name,
          balance: formatMoney(result.accountBalance, result.currency, locale),
        }),
      );
      form.reset({ ...values, amount: '', description: '' });
      setKey(crypto.randomUUID());
      onSaved?.();
    } catch (error) {
      handle(error);
      // A rejected request stored nothing; a new attempt gets a new key.
      setKey(crypto.randomUUID());
    }
  });

  if (accounts.data && accounts.data.length === 0) {
    return (
      <EmptyState title={t('accounts.empty')}>
        <Link href="/app/accounts" className="underline">
          {t('accounts.add')}
        </Link>
      </EmptyState>
    );
  }

  const choices = (categories.data ?? []).filter((c) => c.type === type);

  return (
    <div className="flex flex-col gap-4">
      {embedded ? null : <PageHeader title={t('transactions.new')} />}
      <Card className="max-w-xl">
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert>{formError}</Alert> : null}
          {saved ? <Alert variant="success">{saved}</Alert> : null}

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t('transactions.type')}</legend>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
              {(['EXPENSE', 'INCOME'] as const).map((value) => (
                <label
                  key={value}
                  className={cn(
                    'cursor-pointer rounded-md px-3 py-1.5 text-center text-sm font-medium',
                    type === value ? 'bg-card shadow-xs' : 'text-muted-foreground',
                  )}
                >
                  <input
                    type="radio"
                    value={value}
                    className="sr-only"
                    {...form.register('type', { onChange: () => form.setValue('categoryId', '') })}
                  />
                  {value === 'INCOME' ? t('common.income') : t('common.expense')}
                </label>
              ))}
            </div>
          </fieldset>

          <FormField
            label={t('common.amount')}
            inputMode="decimal"
            autoFocus
            error={errors.amount?.message}
            {...form.register('amount', { setValueAs: (v: string) => v.trim() })}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="trx-account">{t('common.account')}</Label>
            <Select
              id="trx-account"
              aria-invalid={errors.accountId ? true : undefined}
              {...form.register('accountId')}
            >
              <option value="">—</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatMoney(a.balance, a.currency, locale)})
                </option>
              ))}
            </Select>
            {errors.accountId ? (
              <p className="text-xs text-destructive">{errors.accountId.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="trx-category">{t('common.category')}</Label>
            <Select
              id="trx-category"
              aria-invalid={errors.categoryId ? true : undefined}
              {...form.register('categoryId')}
            >
              <option value="">—</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentId ? '— ' : ''}
                  {locale === 'bn' ? c.nameBn : c.nameEn}
                </option>
              ))}
            </Select>
            {errors.categoryId ? (
              <p className="text-xs text-destructive">{errors.categoryId.message}</p>
            ) : null}
          </div>

          <FormField
            label={t('transactions.when')}
            type="datetime-local"
            error={errors.occurredAt?.message}
            {...form.register('occurredAt')}
          />
          <FormField
            label={t('common.description')}
            error={errors.description?.message}
            {...form.register('description')}
          />

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('common.saving') : t('common.save')}
            </Button>
            {embedded ? null : (
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push('/app/transactions')}
              >
                {t('nav.transactions')}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
