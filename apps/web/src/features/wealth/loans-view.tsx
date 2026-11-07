'use client';

import {
  type AccountResponse,
  createLoanRequestSchema,
  LOAN_DIRECTIONS,
  type LoanResponse,
} from '@takawise/contracts';
import { Archive, ArchiveRestore, BellPlus, HandCoins, ListOrdered } from 'lucide-react';
import { useState } from 'react';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/app/page-parts';
import { FormField } from '@/components/forms/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { formatDate, formatMoney } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { useAccountList } from '../finance/queries';
import {
  useArchiveLoan,
  useCreateLoan,
  useLoan,
  useLoanPayment,
  useLoanReminder,
  useLoans,
  useReverseLoanPayment,
} from './queries';
import {
  Disclaimer,
  errorText,
  nowLocalInput,
  SelectField,
  toInstant,
  todayIso,
  useAttemptKey,
} from './wealth-parts';

/** "7884.8800" → "7884.88" so a suggestion fits a money input; display only. */
const twoDp = (v: string) => (v.includes('.') ? v.slice(0, v.indexOf('.') + 3) : v);
/** Sign test on a decimal string, without parsing it into a float. */
const isPositive = (v: string) => !v.startsWith('-') && !/^0(?:\.0+)?$/.test(v);

export function LoansView() {
  const t = useT();
  const loans = useLoans();
  const everyday = useAccountList('ACTIVE', 'EVERYDAY');
  const accounts = everyday.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('loans.title')} />
      <Disclaimer />
      {loans.isPending ? (
        <LoadingBlock />
      ) : loans.isError ? (
        <ErrorBlock onRetry={() => void loans.refetch()} />
      ) : loans.data.length === 0 ? (
        <EmptyState title={t('loans.empty')}>{t('loans.paymentHint')}</EmptyState>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {loans.data.map((loan) => (
            <LoanCard key={loan.id} loan={loan} accounts={accounts} />
          ))}
        </ul>
      )}
      <CreateLoanForm accounts={accounts} />
    </div>
  );
}

function LoanCard({ loan, accounts }: { loan: LoanResponse; accounts: AccountResponse[] }) {
  const t = useT();
  const { locale } = useLocale();
  const archive = useArchiveLoan();
  const reminder = useLoanReminder();
  const [showSchedule, setShowSchedule] = useState(false);
  const [reminded, setReminded] = useState<string | null>(null);
  const money = (v: string) => formatMoney(v, loan.currency, locale);
  const archived = loan.status === 'ARCHIVED';
  const borrowed = loan.direction === 'BORROWED';
  const sameCurrency = accounts.filter((a) => a.currency === loan.currency);

  async function addReminder() {
    if (!loan.nextDueDate) return;
    try {
      await reminder.mutateAsync({
        title: `${borrowed ? t('loans.recordPayment') : t('loans.recordRepayment')}: ${loan.name}`,
        dueAt: new Date(`${loan.nextDueDate}T10:00:00`).toISOString(),
      });
      setReminded(t('loans.reminderAdded'));
    } catch (e) {
      setReminded(errorText(e, t('common.saveError')));
    }
  }

  return (
    <li>
      <Card className="flex h-full flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HandCoins aria-hidden className="size-4 text-brand-teal" />
              {loan.name}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t(`loans.direction.${loan.direction}`)}
              {loan.counterparty ? ` · ${loan.counterparty}` : ''}
            </p>
          </div>
          {archived ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
              {t('accounts.archived')}
            </span>
          ) : null}
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">{t('loans.outstanding')}</span>
          <span className="text-lg font-semibold tabular-nums">{money(loan.outstanding)}</span>
          <span className="ml-2 text-xs text-muted-foreground">/ {money(loan.principal)}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{t('loans.repaid')}</dt>
          <dd className="text-right tabular-nums">{money(loan.principalRepaid)}</dd>
          <dt className="text-muted-foreground">
            {borrowed ? t('loans.interestPaid') : t('loans.interestReceived')}
          </dt>
          <dd className="text-right tabular-nums">{money(loan.interestPaid)}</dd>
          {loan.instalment ? (
            <>
              <dt className="text-muted-foreground">{t('loans.instalment')}</dt>
              <dd className="text-right tabular-nums">{money(loan.instalment)}</dd>
            </>
          ) : null}
        </dl>
        {loan.nextDueDate ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {t('loans.nextDue', { date: formatDate(loan.nextDueDate, locale) })}
            <Button
              variant="ghost"
              size="sm"
              disabled={reminder.isPending}
              onClick={() => void addReminder()}
            >
              <BellPlus aria-hidden /> {t('loans.remind')}
            </Button>
          </p>
        ) : null}
        {reminded ? <p className="text-xs text-muted-foreground">{reminded}</p> : null}
        {!archived && isPositive(loan.outstanding) && sameCurrency.length > 0 ? (
          <PaymentForm loan={loan} accounts={sameCurrency} />
        ) : null}
        <LoanHistory loan={loan} />
        <div className="mt-auto flex flex-wrap gap-2">
          {loan.instalment ? (
            <Button
              variant="outline"
              size="sm"
              aria-expanded={showSchedule}
              onClick={() => setShowSchedule((v) => !v)}
            >
              <ListOrdered aria-hidden />
              {showSchedule ? t('loans.hideSchedule') : t('loans.showSchedule')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={archive.isPending}
            onClick={() => archive.mutate({ id: loan.id, archived: !archived })}
          >
            {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {archived ? t('common.restore') : t('common.archive')}
          </Button>
        </div>
        {showSchedule ? <Schedule loanId={loan.id} currency={loan.currency} /> : null}
      </Card>
    </li>
  );
}

function PaymentForm({ loan, accounts }: { loan: LoanResponse; accounts: AccountResponse[] }) {
  const t = useT();
  const pay = useLoanPayment(loan.id);
  const [key, renew] = useAttemptKey();
  const borrowed = loan.direction === 'BORROWED';
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [principal, setPrincipal] = useState(twoDp(loan.suggestedPayment?.principal ?? ''));
  const [interest, setInterest] = useState(twoDp(loan.suggestedPayment?.interest ?? ''));
  const [when, setWhen] = useState(nowLocalInput);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      const updated = await pay.mutateAsync({
        body: {
          accountId: accountId || accounts[0]!.id,
          occurredAt: toInstant(when),
          principal: principal.trim() || '0',
          interest: interest.trim() || '0',
        },
        key,
      });
      renew();
      setPrincipal(twoDp(updated.suggestedPayment?.principal ?? ''));
      setInterest(twoDp(updated.suggestedPayment?.interest ?? ''));
      setMessage({ ok: true, text: t('settings.saved') });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e, t('common.saveError')) });
      renew();
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      className="flex flex-col gap-2 border-t pt-3"
    >
      <p className="text-sm font-medium">
        {borrowed ? t('loans.recordPayment') : t('loans.recordRepayment')}
      </p>
      <p className="text-xs text-muted-foreground">{t('loans.paymentHint')}</p>
      {message ? <Alert variant={message.ok ? 'success' : undefined}>{message.text}</Alert> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField
          label={borrowed ? t('accounts.source') : t('accounts.destination')}
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
          label={t('transactions.when')}
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <FormField
          label={t('loans.principalPart')}
          inputMode="decimal"
          value={principal}
          onChange={(e) => setPrincipal(e.target.value)}
        />
        <FormField
          label={t('loans.interestPart')}
          inputMode="decimal"
          value={interest}
          onChange={(e) => setInterest(e.target.value)}
        />
      </div>
      <Button type="submit" size="sm" disabled={pay.isPending || (!principal && !interest)}>
        {pay.isPending ? t('common.saving') : t('common.save')}
      </Button>
    </form>
  );
}

function LoanHistory({ loan }: { loan: LoanResponse }) {
  const t = useT();
  const { locale } = useLocale();
  const detail = useLoan(loan.id);
  const reverse = useReverseLoanPayment(loan.id);
  if (!detail.data) return null;
  const payments = detail.data.payments;
  return (
    <div>
      <p className="text-sm font-medium">{t('loans.payments')}</p>
      {payments.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('loans.noPayments')}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border text-sm">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                {formatDate(p.paidOn, locale)} · {p.account.name}
                {p.status === 'REVERSED' ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({t('common.reversed')})
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-2 tabular-nums">
                <span className="text-xs text-muted-foreground">
                  {t('loans.principalPart')} {formatMoney(p.principal, p.currency, locale)} ·{' '}
                  {t('loans.interestPart')} {formatMoney(p.interest, p.currency, locale)}
                </span>
                {p.status === 'POSTED' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={reverse.isPending}
                    onClick={() => reverse.mutate({ paymentId: p.id, key: crypto.randomUUID() })}
                  >
                    {t('loans.undo')}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Schedule({ loanId, currency }: { loanId: string; currency: string }) {
  const t = useT();
  const { locale } = useLocale();
  const detail = useLoan(loanId);
  if (detail.isPending) return <LoadingBlock className="h-24" />;
  if (detail.isError) return <ErrorBlock />;
  const money = (v: string) => formatMoney(v, currency, locale);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t('loans.scheduleHint')}</p>
      <div className="max-h-72 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <caption className="sr-only">{t('loans.schedule')}</caption>
          <thead className="sticky top-0 bg-card">
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="p-2 font-medium">
                #
              </th>
              <th scope="col" className="p-2 font-medium">
                {t('loans.dueDate')}
              </th>
              <th scope="col" className="p-2 text-right font-medium">
                {t('loans.principalPart')}
              </th>
              <th scope="col" className="p-2 text-right font-medium">
                {t('loans.interestPart')}
              </th>
              <th scope="col" className="p-2 text-right font-medium">
                {t('loans.balanceAfter')}
              </th>
            </tr>
          </thead>
          <tbody>
            {detail.data.schedule.map((row) => (
              <tr key={row.number} className="border-b last:border-0">
                <th scope="row" className="p-2 text-left font-normal">
                  {row.number}
                </th>
                <td className="p-2">{formatDate(row.dueDate, locale)}</td>
                <td className="p-2 text-right tabular-nums">{money(row.principal)}</td>
                <td className="p-2 text-right tabular-nums">{money(row.interest)}</td>
                <td className="p-2 text-right tabular-nums">{money(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateLoanForm({ accounts }: { accounts: AccountResponse[] }) {
  const t = useT();
  const { currency } = useLocale();
  const create = useCreateLoan();
  const [key, renew] = useAttemptKey();
  const blank = {
    direction: 'BORROWED' as (typeof LOAN_DIRECTIONS)[number],
    name: '',
    counterparty: '',
    principal: '',
    openingDate: todayIso(),
    disbursementAccountId: '',
    outstandingBalance: '',
    interestRate: '',
    termMonths: '',
    firstPaymentDate: '',
  };
  const [values, setValues] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const set =
    (name: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [name]: e.target.value }));
  const existing = values.disbursementAccountId === '';

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const optional = (v: string) => (v.trim() ? v.trim() : undefined);
    const account = accounts.find((a) => a.id === values.disbursementAccountId);
    const parsed = createLoanRequestSchema.safeParse({
      direction: values.direction,
      name: values.name,
      counterparty: optional(values.counterparty),
      currency: account?.currency ?? currency,
      openingDate: values.openingDate,
      principal: values.principal.trim(),
      disbursementAccountId: optional(values.disbursementAccountId),
      outstandingBalance: existing ? optional(values.outstandingBalance) : undefined,
      interestRate: optional(values.interestRate),
      termMonths: values.termMonths.trim()
        ? Number.parseInt(values.termMonths.trim(), 10)
        : undefined,
      firstPaymentDate: optional(values.firstPaymentDate),
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
        <CardTitle className="sm:col-span-2">{t('loans.add')}</CardTitle>
        {error ? <Alert className="sm:col-span-2">{error}</Alert> : null}
        <SelectField
          label={t('transactions.type')}
          value={values.direction}
          onChange={set('direction')}
        >
          {LOAN_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {t(`loans.direction.${d}`)}
            </option>
          ))}
        </SelectField>
        <FormField label={t('accounts.name')} value={values.name} onChange={set('name')} />
        <FormField
          label={t('loans.counterparty')}
          value={values.counterparty}
          onChange={set('counterparty')}
        />
        <FormField
          label={t('loans.principal')}
          inputMode="decimal"
          value={values.principal}
          onChange={set('principal')}
        />
        <FormField
          label={t('accounts.openingDate')}
          type="date"
          value={values.openingDate}
          onChange={set('openingDate')}
        />
        <SelectField
          label={t('loans.disbursement')}
          value={values.disbursementAccountId}
          onChange={set('disbursementAccountId')}
        >
          <option value="">{t('loans.existing')}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </SelectField>
        {existing ? (
          <FormField
            label={t('loans.outstandingAtStart')}
            inputMode="decimal"
            value={values.outstandingBalance}
            onChange={set('outstandingBalance')}
          />
        ) : null}
        <FormField
          label={t('loans.rate')}
          inputMode="decimal"
          value={values.interestRate}
          onChange={set('interestRate')}
        />
        <FormField
          label={t('loans.term')}
          inputMode="numeric"
          value={values.termMonths}
          onChange={set('termMonths')}
        />
        <FormField
          label={t('loans.firstPayment')}
          type="date"
          value={values.firstPaymentDate}
          onChange={set('firstPaymentDate')}
        />
        <Button type="submit" className="sm:col-span-2" disabled={create.isPending}>
          {create.isPending ? t('common.saving') : t('loans.add')}
        </Button>
      </form>
    </Card>
  );
}
