'use client';

import {
  createNetWorthItemRequestSchema,
  createValuationRequestSchema,
  NET_WORTH_ITEM_KINDS,
  type NetWorthCurrency,
  type NetWorthItemResponse,
  VALUATION_INPUT_SOURCES,
} from '@takawise/contracts';
import { Archive, ArchiveRestore, Home } from 'lucide-react';
import { useState } from 'react';
import { ErrorBlock, LoadingBlock, PageHeader, StatCard } from '@/components/app/page-parts';
import { NetWorthChart } from '@/components/charts/charts';
import { FormField } from '@/components/forms/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { formatMoney } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import {
  useAddItemValuation,
  useArchiveNetWorthItem,
  useCreateNetWorthItem,
  useNetWorth,
  useNetWorthHistory,
  useNetWorthItems,
} from './queries';
import { BasisBadge, Disclaimer, errorText, SelectField, todayIso } from './wealth-parts';

export function NetWorthView() {
  const t = useT();
  const netWorth = useNetWorth();
  const history = useNetWorthHistory(12);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('netWorth.title')} />
      <Disclaimer />
      {netWorth.isPending ? (
        <LoadingBlock />
      ) : netWorth.isError ? (
        <ErrorBlock onRetry={() => void netWorth.refetch()} />
      ) : netWorth.data.currencies.length === 0 ? (
        <EmptyState title={t('netWorth.empty')}>{t('netWorth.itemsHint')}</EmptyState>
      ) : (
        netWorth.data.currencies.map((c) => (
          <CurrencySection
            key={c.currency}
            data={c}
            points={history.data?.series.find((s) => s.currency === c.currency)?.points ?? []}
          />
        ))
      )}
      <ItemsSection />
    </div>
  );
}

function CurrencySection({
  data,
  points,
}: {
  data: NetWorthCurrency;
  points: Array<{ date: string; assets: string; liabilities: string; netWorth: string }>;
}) {
  const t = useT();
  const { locale } = useLocale();
  const money = (v: string) => formatMoney(v, data.currency, locale);
  return (
    <section className="flex flex-col gap-3" aria-label={`${t('netWorth.title')} ${data.currency}`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t('netWorth.net')} hint={t('netWorth.hint', { currency: data.currency })}>
          {money(data.netWorth)}
        </StatCard>
        <StatCard label={t('netWorth.assets')}>{money(data.assets)}</StatCard>
        <StatCard label={t('netWorth.liabilities')}>{money(data.liabilities)}</StatCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          {(['ASSET', 'LIABILITY'] as const).map((side) => {
            const groups = data.groups.filter((g) => g.side === side);
            if (groups.length === 0) return null;
            return (
              <div key={side}>
                <CardTitle>
                  {side === 'ASSET' ? t('netWorth.assets') : t('netWorth.liabilities')}
                </CardTitle>
                <ul className="mt-2 flex flex-col gap-3">
                  {groups.map((g) => (
                    <li key={g.group}>
                      <div className="flex justify-between text-sm font-medium">
                        <span>{t(`netWorth.group.${g.group}`)}</span>
                        <span className="tabular-nums">{money(g.total)}</span>
                      </div>
                      <ul className="mt-1 flex flex-col gap-1">
                        {data.lines
                          .filter((l) => l.group === g.group)
                          .map((l) => (
                            <li
                              key={l.id}
                              className="flex flex-wrap items-center justify-between gap-2 text-xs"
                            >
                              <span className="flex flex-wrap items-center gap-1">
                                {l.name} <BasisBadge basis={l.basis} valuedOn={l.valuedOn} />
                              </span>
                              <span className="tabular-nums">{money(l.value)}</span>
                            </li>
                          ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </Card>
        <Card>
          <CardTitle>{t('netWorth.history')}</CardTitle>
          {points.length > 0 ? (
            <NetWorthChart points={points} currency={data.currency} title={t('netWorth.history')} />
          ) : (
            <LoadingBlock className="h-56" />
          )}
        </Card>
      </div>
    </section>
  );
}

function ItemsSection() {
  const t = useT();
  const items = useNetWorthItems();
  return (
    <section className="flex flex-col gap-3" aria-labelledby="nw-items">
      <h2 id="nw-items" className="text-lg font-semibold">
        {t('netWorth.items')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('netWorth.itemsHint')}</p>
      {items.isPending ? (
        <LoadingBlock className="h-24" />
      ) : items.isError ? (
        <ErrorBlock onRetry={() => void items.refetch()} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {items.data.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </ul>
      )}
      <CreateItemForm />
    </section>
  );
}

function ItemCard({ item }: { item: NetWorthItemResponse }) {
  const t = useT();
  const { locale } = useLocale();
  const archive = useArchiveNetWorthItem();
  const addValue = useAddItemValuation(item.id);
  const [value, setValue] = useState('');
  const [valuedOn, setValuedOn] = useState(todayIso);
  const [error, setError] = useState<string | null>(null);
  const archived = item.status === 'ARCHIVED';

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = createValuationRequestSchema.safeParse({ value: value.trim(), valuedOn });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('common.saveError'));
      return;
    }
    setError(null);
    try {
      await addValue.mutateAsync(parsed.data);
      setValue('');
    } catch (e) {
      setError(errorText(e, t('common.saveError')));
    }
  }

  return (
    <li>
      <Card className="flex h-full flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Home aria-hidden className="size-4 text-brand-teal" />
              {item.name}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t(`netWorth.kind.${item.kind}`)} ·{' '}
              {item.side === 'ASSET' ? t('netWorth.assets') : t('netWorth.liabilities')}
            </p>
          </div>
          {archived ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
              {t('accounts.archived')}
            </span>
          ) : null}
        </div>
        {item.value ? (
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold tabular-nums">
              {formatMoney(item.value, item.currency, locale)}
            </span>
            {item.valueBasis ? (
              <BasisBadge basis={item.valueBasis} valuedOn={item.valuedOn} />
            ) : null}
          </p>
        ) : null}
        {!archived ? (
          <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-2">
            {error ? <Alert>{error}</Alert> : null}
            <div className="grid grid-cols-2 gap-2">
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
            </div>
            <Button type="submit" size="sm" disabled={addValue.isPending || !value}>
              {t('wealth.addValue')}
            </Button>
          </form>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="mt-auto self-start"
          disabled={archive.isPending}
          onClick={() => archive.mutate({ id: item.id, archived: !archived })}
        >
          {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          {archived ? t('common.restore') : t('common.archive')}
        </Button>
      </Card>
    </li>
  );
}

function CreateItemForm() {
  const t = useT();
  const { currency } = useLocale();
  const create = useCreateNetWorthItem();
  const blank = {
    name: '',
    kind: 'REAL_ESTATE' as (typeof NET_WORTH_ITEM_KINDS)[number],
    value: '',
    valuedOn: todayIso(),
    source: 'USER_ENTERED' as (typeof VALUATION_INPUT_SOURCES)[number],
  };
  const [values, setValues] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const set =
    (name: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [name]: e.target.value }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = createNetWorthItemRequestSchema.safeParse({
      ...values,
      value: values.value.trim(),
      currency,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('common.saveError'));
      return;
    }
    setError(null);
    try {
      await create.mutateAsync(parsed.data);
      setValues(blank);
    } catch (e) {
      setError(errorText(e, t('common.saveError')));
    }
  }

  return (
    <Card>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-3 sm:grid-cols-2">
        <CardTitle className="sm:col-span-2">{t('netWorth.addItem')}</CardTitle>
        {error ? <Alert className="sm:col-span-2">{error}</Alert> : null}
        <FormField label={t('accounts.name')} value={values.name} onChange={set('name')} />
        <SelectField label={t('transactions.type')} value={values.kind} onChange={set('kind')}>
          {NET_WORTH_ITEM_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`netWorth.kind.${k}`)}
            </option>
          ))}
        </SelectField>
        <FormField
          label={t('wealth.value')}
          inputMode="decimal"
          value={values.value}
          onChange={set('value')}
        />
        <FormField
          label={t('common.date')}
          type="date"
          value={values.valuedOn}
          onChange={set('valuedOn')}
        />
        <SelectField label={t('wealth.valueSource')} value={values.source} onChange={set('source')}>
          {VALUATION_INPUT_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`wealth.basis.${s}`)}
            </option>
          ))}
        </SelectField>
        <Button type="submit" className="sm:col-span-2" disabled={create.isPending}>
          {create.isPending ? t('common.saving') : t('netWorth.addItem')}
        </Button>
      </form>
    </Card>
  );
}
