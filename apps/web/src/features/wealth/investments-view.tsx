'use client';

import {
  type AccountResponse,
  createInvestmentRequestSchema,
  createValuationRequestSchema,
  INVESTMENT_KINDS,
  type InvestmentResponse,
  VALUATION_INPUT_SOURCES,
} from '@takawise/contracts';
import { Archive, ArchiveRestore, Settings2, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/app/page-parts';
import { FormField } from '@/components/forms/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { formatDate, formatMoney } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { useAccountList } from '../finance/queries';
import { useCategories } from '../planning/queries';
import {
  useAddInvestmentValuation,
  useArchiveInvestment,
  useCreateInvestment,
  useDeleteInvestmentValuation,
  useInvestment,
  useInvestments,
  useWealthIncome,
  useWealthTransfer,
} from './queries';
import {
  BasisBadge,
  Disclaimer,
  errorText,
  nowLocalInput,
  SelectField,
  toInstant,
  todayIso,
  useAttemptKey,
} from './wealth-parts';

/** "9.5000" → "9.5" for display; no arithmetic on the value. */
const trimZeros = (v: string) => (v.includes('.') ? v.replace(/\.?0+$/, '') : v);

export function InvestmentsView() {
  const t = useT();
  const investments = useInvestments();
  const everyday = useAccountList('ACTIVE', 'EVERYDAY');
  const accounts = everyday.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('investments.title')} />
      <Disclaimer />
      {investments.isPending ? (
        <LoadingBlock />
      ) : investments.isError ? (
        <ErrorBlock onRetry={() => void investments.refetch()} />
      ) : investments.data.length === 0 ? (
        <EmptyState title={t('investments.empty')}>{t('investments.fundingHint')}</EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {investments.data.map((inv) => (
            <InvestmentCard key={inv.id} investment={inv} accounts={accounts} />
          ))}
        </ul>
      )}
      <CreateInvestmentForm accounts={accounts} />
    </div>
  );
}

function InvestmentCard({
  investment,
  accounts,
}: {
  investment: InvestmentResponse;
  accounts: AccountResponse[];
}) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const archive = useArchiveInvestment();
  const money = (v: string) => formatMoney(v, investment.currency, locale);
  const archived = investment.status === 'ARCHIVED';
  const sameCurrency = accounts.filter((a) => a.currency === investment.currency);

  return (
    <li>
      <Card className="flex h-full flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp aria-hidden className="size-4 text-brand-teal" />
              {investment.name}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t(`investments.kind.${investment.kind}`)}
              {investment.institutionName ? ` · ${investment.institutionName}` : ''}
              {investment.maturityDate
                ? ` · ${t('investments.maturesOn', { date: formatDate(investment.maturityDate, locale) })}`
                : ''}
            </p>
          </div>
          {archived ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
              {t('accounts.archived')}
            </span>
          ) : null}
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">{t('investments.current')}</span>
          <span className="text-lg font-semibold tabular-nums">
            {money(investment.currentValue)}
          </span>{' '}
          <BasisBadge basis={investment.valueBasis} valuedOn={investment.valuedOn} />
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{t('investments.recorded')}</dt>
          <dd className="text-right tabular-nums">{money(investment.recordedValue)}</dd>
          {investment.interestRate ? (
            <>
              <dt className="text-muted-foreground">{t('investments.rate')}</dt>
              <dd className="text-right tabular-nums">{trimZeros(investment.interestRate)}%</dd>
            </>
          ) : null}
          {investment.expectedMaturityValue ? (
            <>
              <dt className="text-muted-foreground">{t('investments.expected')}</dt>
              <dd className="text-right tabular-nums">{money(investment.expectedMaturityValue)}</dd>
            </>
          ) : null}
          {investment.quantity ? (
            <>
              <dt className="text-muted-foreground">{t('investments.quantity')}</dt>
              <dd className="text-right tabular-nums">
                {trimZeros(investment.quantity)} {investment.quantityUnit ?? ''}
              </dd>
            </>
          ) : null}
        </dl>
        <div className="mt-auto flex flex-wrap gap-2">
          {!archived ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              <Settings2 aria-hidden /> {t('investments.manage')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={archive.isPending}
            onClick={() => archive.mutate({ id: investment.id, archived: !archived })}
          >
            {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {archived ? t('common.restore') : t('common.archive')}
          </Button>
        </div>
        {open ? (
          <div className="flex flex-col gap-4 border-t pt-3">
            <MoveMoneyForm investment={investment} accounts={sameCurrency} />
            <ReturnForm investment={investment} />
            <ValuationSection investment={investment} />
          </div>
        ) : null}
      </Card>
    </li>
  );
}

/** Add money / withdraw = a transfer between the investment and an everyday account. */
function MoveMoneyForm({
  investment,
  accounts,
}: {
  investment: InvestmentResponse;
  accounts: AccountResponse[];
}) {
  const t = useT();
  const transfer = useWealthTransfer();
  const [key, renew] = useAttemptKey();
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState(nowLocalInput);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (accounts.length === 0) return null;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const other = accountId || accounts[0]!.id;
    try {
      await transfer.mutateAsync({
        body: {
          sourceAccountId: direction === 'IN' ? other : investment.id,
          destinationAccountId: direction === 'IN' ? investment.id : other,
          amount: amount.trim(),
          currency: investment.currency,
          occurredAt: toInstant(when),
        },
        key,
      });
      setAmount('');
      renew();
      setMessage({ ok: true, text: t('settings.saved') });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e, t('common.saveError')) });
      renew();
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t('investments.moveHint')}</p>
      {message ? <Alert variant={message.ok ? 'success' : undefined}>{message.text}</Alert> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField
          label={t('transactions.type')}
          value={direction}
          onChange={(e) => setDirection(e.target.value as 'IN' | 'OUT')}
        >
          <option value="IN">{t('investments.addMoney')}</option>
          <option value="OUT">{t('investments.withdraw')}</option>
        </SelectField>
        <SelectField
          label={t('common.account')}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </SelectField>
        <FormField
          label={t('common.amount')}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <FormField
          label={t('transactions.when')}
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </div>
      <Button type="submit" size="sm" disabled={transfer.isPending || !amount}>
        {transfer.isPending ? t('common.saving') : t('common.save')}
      </Button>
    </form>
  );
}

/** Profit or interest credited to the investment is income (counted in reports). */
function ReturnForm({ investment }: { investment: InvestmentResponse }) {
  const t = useT();
  const { locale } = useLocale();
  const categories = useCategories('INCOME');
  const income = useWealthIncome();
  const [key, renew] = useAttemptKey();
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState(nowLocalInput);
  const [categoryId, setCategoryId] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const options = (categories.data ?? []).filter((c) => c.status === 'ACTIVE');
  const fallback = options.find((c) => c.nameEn === 'Profit & Interest') ?? options[0];

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const category = categoryId || fallback?.id;
    if (!category) return;
    try {
      await income.mutateAsync({
        body: {
          type: 'INCOME',
          accountId: investment.id,
          categoryId: category,
          amount: amount.trim(),
          currency: investment.currency,
          occurredAt: toInstant(when),
        },
        key,
      });
      setAmount('');
      renew();
      setMessage({ ok: true, text: t('settings.saved') });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e, t('common.saveError')) });
      renew();
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-2">
      <p className="text-sm font-medium">{t('investments.recordReturn')}</p>
      {message ? <Alert variant={message.ok ? 'success' : undefined}>{message.text}</Alert> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <FormField
          label={t('common.amount')}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <FormField
          label={t('transactions.when')}
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <SelectField
          label={t('common.category')}
          value={categoryId || fallback?.id || ''}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {locale === 'bn' ? c.nameBn : c.nameEn}
            </option>
          ))}
        </SelectField>
      </div>
      <Button type="submit" size="sm" disabled={income.isPending || !amount}>
        {income.isPending ? t('common.saving') : t('common.save')}
      </Button>
    </form>
  );
}

function ValuationSection({ investment }: { investment: InvestmentResponse }) {
  const t = useT();
  const { locale } = useLocale();
  const detail = useInvestment(investment.id);
  const add = useAddInvestmentValuation(investment.id);
  const remove = useDeleteInvestmentValuation(investment.id);
  const [value, setValue] = useState('');
  const [valuedOn, setValuedOn] = useState(todayIso);
  const [source, setSource] = useState<(typeof VALUATION_INPUT_SOURCES)[number]>('USER_ENTERED');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = createValuationRequestSchema.safeParse({
      value: value.trim(),
      valuedOn,
      source,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('common.saveError'));
      return;
    }
    setError(null);
    try {
      await add.mutateAsync(parsed.data);
      setValue('');
    } catch (e) {
      setError(errorText(e, t('common.saveError')));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t('wealth.addValue')}</p>
        {error ? <Alert>{error}</Alert> : null}
        <div className="grid gap-2 sm:grid-cols-3">
          <FormField
            label={t('wealth.value')}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <FormField
            label={t('common.date')}
            type="date"
            value={valuedOn}
            onChange={(e) => setValuedOn(e.target.value)}
          />
          <SelectField
            label={t('wealth.valueSource')}
            value={source}
            onChange={(e) => setSource(e.target.value as typeof source)}
          >
            {VALUATION_INPUT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`wealth.basis.${s}`)}
              </option>
            ))}
          </SelectField>
        </div>
        <Button type="submit" size="sm" disabled={add.isPending || !value}>
          {add.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </form>
      {detail.data && detail.data.valuations.length > 0 ? (
        <div>
          <p className="text-sm font-medium">{t('wealth.history')}</p>
          <ul className="flex flex-col divide-y rounded-md border text-sm">
            {detail.data.valuations.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>
                  {formatDate(v.valuedOn, locale)} · {t(`wealth.basis.${v.source}`)}
                </span>
                <span className="flex items-center gap-2 tabular-nums">
                  {formatMoney(v.value, v.currency, locale)}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(v.id)}
                  >
                    {t('wealth.delete')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CreateInvestmentForm({ accounts }: { accounts: AccountResponse[] }) {
  const t = useT();
  const { currency } = useLocale();
  const create = useCreateInvestment();
  const [key, renew] = useAttemptKey();
  const blank = {
    name: '',
    kind: 'FDR' as (typeof INVESTMENT_KINDS)[number],
    initialAmount: '',
    openingDate: todayIso(),
    fundingAccountId: '',
    institutionName: '',
    interestRate: '',
    maturityDate: '',
    expectedMaturityValue: '',
  };
  const [values, setValues] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const set =
    (name: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [name]: e.target.value }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const optional = (v: string) => (v.trim() ? v.trim() : undefined);
    const funding = accounts.find((a) => a.id === values.fundingAccountId);
    const parsed = createInvestmentRequestSchema.safeParse({
      name: values.name,
      kind: values.kind,
      currency: funding?.currency ?? currency,
      openingDate: values.openingDate,
      initialAmount: values.initialAmount.trim() || '0',
      fundingAccountId: optional(values.fundingAccountId),
      institutionName: optional(values.institutionName),
      interestRate: optional(values.interestRate),
      maturityDate: optional(values.maturityDate),
      expectedMaturityValue: optional(values.expectedMaturityValue),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('common.saveError'));
      return;
    }
    setError(null);
    try {
      await create.mutateAsync({ body: parsed.data, key });
      setValues(blank);
      renew();
    } catch (e) {
      setError(errorText(e, t('common.saveError')));
      renew();
    }
  }

  return (
    <Card>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-3 sm:grid-cols-2">
        <CardTitle className="sm:col-span-2">{t('investments.add')}</CardTitle>
        {error ? <Alert className="sm:col-span-2">{error}</Alert> : null}
        <FormField label={t('accounts.name')} value={values.name} onChange={set('name')} />
        <SelectField label={t('investments.kind')} value={values.kind} onChange={set('kind')}>
          {INVESTMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`investments.kind.${k}`)}
            </option>
          ))}
        </SelectField>
        <FormField
          label={t('investments.initialAmount')}
          inputMode="decimal"
          value={values.initialAmount}
          onChange={set('initialAmount')}
        />
        <FormField
          label={t('accounts.openingDate')}
          type="date"
          value={values.openingDate}
          onChange={set('openingDate')}
        />
        <div className="sm:col-span-2">
          <SelectField
            label={t('investments.fundingAccount')}
            value={values.fundingAccountId}
            onChange={set('fundingAccountId')}
          >
            <option value="">{t('wealth.alreadyHeld')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </SelectField>
          <p className="mt-1 text-xs text-muted-foreground">{t('investments.fundingHint')}</p>
        </div>
        <FormField
          label={t('accounts.institution')}
          value={values.institutionName}
          onChange={set('institutionName')}
        />
        <FormField
          label={t('investments.rate')}
          inputMode="decimal"
          value={values.interestRate}
          onChange={set('interestRate')}
        />
        <FormField
          label={t('investments.maturity')}
          type="date"
          value={values.maturityDate}
          onChange={set('maturityDate')}
        />
        <FormField
          label={t('investments.expected')}
          inputMode="decimal"
          value={values.expectedMaturityValue}
          onChange={set('expectedMaturityValue')}
        />
        <Button type="submit" className="sm:col-span-2" disabled={create.isPending}>
          {create.isPending ? t('common.saving') : t('investments.add')}
        </Button>
      </form>
    </Card>
  );
}
