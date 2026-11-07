'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type AccountResponse,
  type AccountType,
  createAccountRequestSchema,
  createTransferRequestSchema,
  EVERYDAY_ACCOUNT_TYPES,
} from '@takawise/contracts';
import {
  ArrowLeftRight,
  Archive,
  ArchiveRestore,
  CreditCard,
  HandCoins,
  Landmark,
  type LucideIcon,
  Smartphone,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/app/page-parts';
import { FormField } from '@/components/forms/form-field';
import { useApiFormError } from '@/components/forms/use-api-form-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatMoney } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { useAccountList, useArchiveAccount, useCreateAccount, useCreateTransfer } from './queries';

const ICONS: Record<AccountType, LucideIcon> = {
  CASH: Wallet,
  BANK: Landmark,
  MOBILE_WALLET: Smartphone,
  SAVINGS: Landmark,
  CREDIT_CARD_TRACKING: CreditCard,
  OTHER: Wallet,
  INVESTMENT: TrendingUp,
  LOAN: HandCoins,
  LOAN_RECEIVABLE: HandCoins,
};

export function AccountsView() {
  const t = useT();
  const [showArchived, setShowArchived] = useState(false);
  // Investments and loans live on their own pages (Phase 8).
  const accounts = useAccountList(showArchived ? 'ALL' : 'ACTIVE', 'EVERYDAY');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('accounts.title')}
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t('accounts.showArchived')}
          </label>
        }
      />
      {accounts.isPending ? (
        <LoadingBlock />
      ) : accounts.isError ? (
        <ErrorBlock onRetry={() => void accounts.refetch()} />
      ) : accounts.data.length === 0 ? (
        <EmptyState title={t('accounts.empty')}>{t('dashboard.getStarted')}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.data.map((a) => (
            <AccountCard key={a.id} account={a} />
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">
        {t('accounts.wealthHint')}{' '}
        <Link className="underline" href="/app/investments">
          {t('nav.investments')}
        </Link>
        {' · '}
        <Link className="underline" href="/app/loans">
          {t('nav.loans')}
        </Link>
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <CreateAccountForm />
        {accounts.data && accounts.data.filter((a) => a.status === 'ACTIVE').length >= 2 ? (
          <TransferForm accounts={accounts.data.filter((a) => a.status === 'ACTIVE')} />
        ) : null}
      </div>
    </div>
  );
}

function AccountCard({ account }: { account: AccountResponse }) {
  const t = useT();
  const { locale } = useLocale();
  const archive = useArchiveAccount();
  const Icon = ICONS[account.type];
  const liability = account.balanceType === 'LIABILITY';
  const archived = account.status === 'ARCHIVED';
  return (
    <li>
      <Card className="flex h-full flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon aria-hidden className="size-4 text-brand-teal" />
            <CardTitle>{account.name}</CardTitle>
          </div>
          {archived ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
              {t('accounts.archived')}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {t(`accounts.type.${account.type}`)}
          {account.institutionName ? ` · ${account.institutionName}` : ''}
        </p>
        <p className="mt-auto">
          <span className="block text-xs text-muted-foreground">
            {liability ? t('accounts.owed') : t('accounts.balance')}
          </span>
          <span className="text-lg font-semibold tabular-nums">
            {formatMoney(account.balance, account.currency, locale)}
          </span>
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={archive.isPending}
          onClick={() => archive.mutate({ id: account.id, archived: !archived })}
        >
          {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          {archived ? t('common.restore') : t('common.archive')}
        </Button>
      </Card>
    </li>
  );
}

type AccountValues = z.input<typeof createAccountRequestSchema>;

function CreateAccountForm() {
  const t = useT();
  const { currency } = useLocale();
  const create = useCreateAccount();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const form = useForm<AccountValues, unknown, z.output<typeof createAccountRequestSchema>>({
    resolver: zodResolver(createAccountRequestSchema),
    defaultValues: {
      name: '',
      type: 'CASH',
      currency,
      openingDate: new Date().toISOString().slice(0, 10),
      openingBalance: '0',
    },
  });
  const { formError, handle } = useApiFormError(form.setError);
  const type = form.watch('type');
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ creditLimit, institutionName, ...values }) => {
    try {
      await create.mutateAsync({
        body: {
          ...values,
          ...(institutionName ? { institutionName } : {}),
          ...(creditLimit ? { creditLimit } : {}),
        },
        key,
      });
      form.reset({
        ...form.getValues(),
        name: '',
        openingBalance: '0',
        institutionName: '',
        creditLimit: undefined,
      });
      setKey(crypto.randomUUID());
    } catch (error) {
      handle(error);
      setKey(crypto.randomUUID());
    }
  });

  return (
    <Card>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-3 sm:grid-cols-2">
        <CardTitle className="sm:col-span-2">{t('accounts.add')}</CardTitle>
        {formError ? <Alert className="sm:col-span-2">{formError}</Alert> : null}
        <FormField
          label={t('accounts.name')}
          error={errors.name?.message}
          {...form.register('name')}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-type">{t('accounts.type')}</Label>
          <Select id="account-type" {...form.register('type')}>
            {EVERYDAY_ACCOUNT_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`accounts.type.${value}`)}
              </option>
            ))}
          </Select>
        </div>
        <FormField
          label={
            type === 'CREDIT_CARD_TRACKING'
              ? t('accounts.openingBalanceCard')
              : t('accounts.openingBalance')
          }
          inputMode="decimal"
          error={errors.openingBalance?.message}
          {...form.register('openingBalance')}
        />
        <FormField
          label={t('accounts.openingDate')}
          type="date"
          error={errors.openingDate?.message}
          {...form.register('openingDate')}
        />
        <FormField
          label={t('accounts.currency')}
          maxLength={3}
          error={errors.currency?.message}
          {...form.register('currency', { setValueAs: (v: string) => v.toUpperCase() })}
        />
        <FormField
          label={t('accounts.institution')}
          error={errors.institutionName?.message}
          {...form.register('institutionName')}
        />
        {type === 'CREDIT_CARD_TRACKING' ? (
          <FormField
            label={t('accounts.creditLimit')}
            inputMode="decimal"
            error={errors.creditLimit?.message}
            {...form.register('creditLimit', { setValueAs: (v: string) => (v ? v : undefined) })}
          />
        ) : null}
        <p className="text-xs text-muted-foreground sm:col-span-2">{t('accounts.fixedFields')}</p>
        <Button type="submit" className="sm:col-span-2" disabled={isSubmitting}>
          {isSubmitting ? t('common.saving') : t('accounts.add')}
        </Button>
      </form>
    </Card>
  );
}

type TransferValues = z.input<typeof createTransferRequestSchema>;

function TransferForm({ accounts }: { accounts: AccountResponse[] }) {
  const t = useT();
  const { locale } = useLocale();
  const create = useCreateTransfer();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [done, setDone] = useState(false);
  const form = useForm<{
    sourceAccountId: string;
    destinationAccountId: string;
    amount: string;
    date: string;
    description: string;
  }>({
    defaultValues: {
      sourceAccountId: accounts[0]?.id ?? '',
      destinationAccountId: accounts[1]?.id ?? '',
      amount: '',
      date: new Date().toISOString().slice(0, 16),
      description: '',
    },
  });
  const { formError, handle, setFormError } = useApiFormError(form.setError);

  const onSubmit = form.handleSubmit(async (values) => {
    setDone(false);
    const source = accounts.find((a) => a.id === values.sourceAccountId);
    const body: TransferValues = {
      sourceAccountId: values.sourceAccountId,
      destinationAccountId: values.destinationAccountId,
      amount: values.amount.trim(),
      currency: source?.currency ?? 'BDT',
      occurredAt: new Date(values.date).toISOString(),
      ...(values.description ? { description: values.description } : {}),
    };
    const parsed = createTransferRequestSchema.safeParse(body);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? t('common.saveError'));
      return;
    }
    try {
      await create.mutateAsync({ body: parsed.data, key });
      form.reset({ ...values, amount: '', description: '' });
      setKey(crypto.randomUUID());
      setDone(true);
    } catch (error) {
      handle(error);
      setKey(crypto.randomUUID());
    }
  });

  const option = (a: AccountResponse) => (
    <option key={a.id} value={a.id}>
      {a.name} ({formatMoney(a.balance, a.currency, locale)})
    </option>
  );

  return (
    <Card>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-3">
        <CardTitle className="flex items-center gap-2">
          <ArrowLeftRight aria-hidden className="size-4" /> {t('accounts.transfer')}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t('accounts.transferHint')}</p>
        {formError ? <Alert>{formError}</Alert> : null}
        {done ? <Alert variant="success">{t('settings.saved')}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transfer-source">{t('accounts.source')}</Label>
            <Select id="transfer-source" {...form.register('sourceAccountId')}>
              {accounts.map(option)}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transfer-destination">{t('accounts.destination')}</Label>
            <Select id="transfer-destination" {...form.register('destinationAccountId')}>
              {accounts.map(option)}
            </Select>
          </div>
          <FormField
            label={t('common.amount')}
            inputMode="decimal"
            {...form.register('amount', { required: true })}
          />
          <FormField
            label={t('transactions.when')}
            type="datetime-local"
            {...form.register('date', { required: true })}
          />
        </div>
        <FormField label={t('common.description')} {...form.register('description')} />
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </form>
    </Card>
  );
}
