'use client';

import { createGoalRequestSchema, type GoalResponse } from '@takawise/contracts';
import { History, PiggyBank, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useSession } from '@/components/auth/auth-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProgressBar } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import {
  useAccounts,
  useContribute,
  useCreateGoal,
  useGoal,
  useGoals,
  useReverseContribution,
} from './queries';

const errorText = (e: unknown) =>
  e instanceof ApiError
    ? (e.details[0]?.message ?? e.message)
    : 'Something went wrong. Please try again.';

export function GoalsView() {
  const session = useSession();
  const locale = session.status === 'authenticated' ? session.user.profile.locale : 'en';
  const goals = useGoals();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Savings goals</h1>
      <p className="text-sm text-muted-foreground">
        Goal savings are set aside from an account you choose. No money is moved — your account
        balance stays the same.
      </p>
      {goals.isPending ? (
        <div
          role="status"
          className="h-32 animate-pulse rounded-lg bg-secondary"
          aria-label="Loading goals"
        />
      ) : goals.isError ? (
        <Alert>Could not load goals.</Alert>
      ) : goals.data.length === 0 ? (
        <EmptyState title="No goals yet">
          Create a goal below, e.g. Eid shopping or an emergency fund.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {goals.data.map((goal) => (
            <GoalCard key={goal.id} goal={goal} locale={locale} />
          ))}
        </div>
      )}
      <CreateGoalForm />
    </div>
  );
}

function GoalCard({ goal, locale }: { goal: GoalResponse; locale: 'en' | 'bn' }) {
  const money = (v: string) => formatMoney(v, goal.currency, locale);
  const [showHistory, setShowHistory] = useState(false);
  const closed = goal.status === 'ARCHIVED';
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <PiggyBank aria-hidden className="size-4 text-brand-teal" />
            {goal.name}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            From {goal.linkedAccount.name}
            {goal.targetDate ? ` · by ${formatDate(goal.targetDate, locale)}` : ''}
          </p>
        </div>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
          {goal.status}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span>{money(goal.saved)} saved</span>
        <span>of {money(goal.targetAmount)}</span>
      </div>
      <ProgressBar label={`${goal.name} progress`} percent={goal.percent} showStatus={false} />
      <p className="text-xs text-muted-foreground">
        {goal.percent}% · {money(goal.remaining)} to go
      </p>
      {goal.underFunded ? (
        <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert aria-hidden className="size-3.5" />
          {goal.linkedAccount.name} now holds {money(goal.linkedAccount.balance)}, less than the{' '}
          {money(goal.linkedAccount.earmarked)} set aside for its goals.
        </p>
      ) : null}
      {!closed ? <ContributeForm goal={goal} /> : null}
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => setShowHistory((s) => !s)}
        aria-expanded={showHistory}
      >
        <History aria-hidden /> {showHistory ? 'Hide history' : 'Show history'}
      </Button>
      {showHistory ? (
        <GoalHistory goalId={goal.id} currency={goal.currency} locale={locale} />
      ) : null}
    </Card>
  );
}

function ContributeForm({ goal }: { goal: GoalResponse }) {
  const contribute = useContribute(goal.id);
  const [kind, setKind] = useState<'CONTRIBUTION' | 'WITHDRAWAL'>('CONTRIBUTION');
  const [amount, setAmount] = useState('');
  // One key per attempt: retries of the same attempt are de-duplicated by the API.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await contribute.mutateAsync({ body: { kind, amount }, key });
      setAmount('');
      setKey(crypto.randomUUID());
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.status < 500) setKey(crypto.randomUUID());
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-2" noValidate>
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex gap-2">
        <Select
          aria-label="Set aside or release"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="w-36"
        >
          <option value="CONTRIBUTION">Set aside</option>
          <option value="WITHDRAWAL">Release</option>
        </Select>
        <Input
          aria-label="Amount"
          inputMode="decimal"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value.trim())}
        />
        <Button type="submit" disabled={contribute.isPending || !amount}>
          Save
        </Button>
      </div>
    </form>
  );
}

function GoalHistory({
  goalId,
  currency,
  locale,
}: {
  goalId: string;
  currency: string;
  locale: 'en' | 'bn';
}) {
  const detail = useGoal(goalId);
  const reverse = useReverseContribution(goalId);
  if (detail.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (detail.isError) return <Alert>Could not load history.</Alert>;
  const entries = [...detail.data.contributions].reverse();
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No entries yet.</p>;
  const label = { CONTRIBUTION: 'Set aside', WITHDRAWAL: 'Released', REVERSAL: 'Correction' };
  return (
    <ul className="flex flex-col divide-y rounded-md border text-sm">
      {entries.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
          <span>
            {label[c.kind]} · {formatDate(c.contributedOn, locale)}
            {c.status === 'REVERSED' ? (
              <span className="ml-1 text-xs text-muted-foreground">(reversed)</span>
            ) : null}
          </span>
          <span className="flex items-center gap-2">
            {c.kind === 'WITHDRAWAL' ? '−' : c.kind === 'REVERSAL' ? '±' : '+'}
            {formatMoney(c.amount, currency, locale)}
            {c.kind !== 'REVERSAL' && c.status === 'POSTED' ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={reverse.isPending}
                onClick={() => reverse.mutate({ contributionId: c.id, key: crypto.randomUUID() })}
              >
                Undo
              </Button>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CreateGoalForm() {
  const accounts = useAccounts();
  const create = useCreateGoal();
  const [values, setValues] = useState({
    name: '',
    targetAmount: '',
    targetDate: '',
    linkedAccountId: '',
  });
  const [error, setError] = useState<string | null>(null);
  const eligible = (accounts.data ?? []).filter(
    (a) => a.type !== 'CREDIT_CARD_TRACKING' && a.status === 'ACTIVE',
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = createGoalRequestSchema.safeParse({
      name: values.name,
      targetAmount: values.targetAmount,
      linkedAccountId: values.linkedAccountId,
      ...(values.targetDate ? { targetDate: values.targetDate } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the form.');
      return;
    }
    setError(null);
    try {
      await create.mutateAsync(parsed.data);
      setValues({ name: '', targetAmount: '', targetDate: '', linkedAccountId: '' });
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (!accounts.isPending && eligible.length === 0) {
    return (
      <EmptyState title="Add an account first">
        Goals set money aside inside a cash, bank, wallet or savings account.{' '}
        <Link className="underline" href="/app/accounts">
          Go to accounts
        </Link>
      </EmptyState>
    );
  }

  const field = (name: keyof typeof values) => ({
    id: `goal-${name}`,
    value: values[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [name]: e.target.value })),
  });

  return (
    <Card>
      <form onSubmit={(e) => void onSubmit(e)} className="grid gap-3 sm:grid-cols-2" noValidate>
        <CardTitle className="sm:col-span-2">New goal</CardTitle>
        {error ? <Alert className="sm:col-span-2">{error}</Alert> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-name">Name</Label>
          <Input {...field('name')} placeholder="Eid shopping" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-targetAmount">Target amount</Label>
          <Input {...field('targetAmount')} inputMode="decimal" placeholder="20000" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-linkedAccountId">Set aside from</Label>
          <Select {...field('linkedAccountId')}>
            <option value="">Choose an account</option>
            {eligible.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-targetDate">Target date (optional)</Label>
          <Input {...field('targetDate')} type="date" />
        </div>
        <Button type="submit" className="sm:col-span-2" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create goal'}
        </Button>
      </form>
    </Card>
  );
}
