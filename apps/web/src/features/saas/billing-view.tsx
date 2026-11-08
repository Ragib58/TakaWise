'use client';

import type { PlanEntitlements, PlanResponse } from '@takawise/contracts';
import { Check, Minus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/app/page-parts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n/messages';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { useBilling, useCancelSubscription, useCheckout, useCompleteFakeCheckout } from './queries';

export const errorMessage = (e: unknown, fallback: string) =>
  e instanceof ApiError ? (e.details[0]?.message ?? e.message) : fallback;

const FEATURE_ROWS: Array<{ key: keyof PlanEntitlements; label: MessageKey }> = [
  { key: 'maxAccounts', label: 'billing.feature.accounts' },
  { key: 'aiInsights', label: 'billing.feature.aiInsights' },
  { key: 'aiDrafts', label: 'billing.feature.aiDrafts' },
  { key: 'receiptOcr', label: 'billing.feature.receiptOcr' },
  { key: 'familyWorkspace', label: 'billing.feature.family' },
];

function FeatureList({ entitlements }: { entitlements: PlanEntitlements }) {
  const t = useT();
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {FEATURE_ROWS.map(({ key, label }) => {
        const value = entitlements[key];
        const on = key === 'maxAccounts' ? true : Boolean(value);
        const text =
          key === 'maxAccounts'
            ? value === null
              ? t('billing.feature.accountsUnlimited')
              : t('billing.feature.accountsUpTo', { count: String(value) })
            : key === 'familyWorkspace' && on
              ? t('billing.feature.familyUpTo', { count: entitlements.maxFamilyMembers })
              : t(label);
        return (
          <li key={key} className={on ? '' : 'text-muted-foreground'}>
            {on ? (
              <Check aria-hidden className="mr-1 inline size-4 text-positive" />
            ) : (
              <Minus aria-hidden className="mr-1 inline size-4" />
            )}
            <span className="sr-only">
              {on ? t('billing.included') : t('billing.notIncluded')}:{' '}
            </span>
            {text}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * /app/billing: current plan, what it includes, and upgrades through the
 * provider's hosted checkout. The server enforces every limit shown here.
 */
export function BillingView() {
  const t = useT();
  const { locale } = useLocale();
  const billing = useBilling();
  const checkout = useCheckout();
  const completeFake = useCompleteFakeCheckout();
  const cancel = useCancelSubscription();
  const pendingCheckout = useSearchParams().get('checkout');

  if (billing.isPending) return <LoadingBlock />;
  if (billing.isError) return <ErrorBlock onRetry={() => void billing.refetch()} />;
  const data = billing.data;
  const sub = data.subscription;

  const price = (p: PlanResponse) =>
    p.priceAmount === '0.0000'
      ? t('billing.free')
      : `${formatMoney(p.priceAmount, p.currency, locale)} / ${t(p.interval === 'YEAR' ? 'billing.year' : 'billing.month')}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('billing.title')} />

      {pendingCheckout && data.provider === 'fake' ? (
        <Card className="flex flex-col gap-2 border-dashed">
          <CardTitle>{t('billing.fakeTitle')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('billing.fakeHint')}</p>
          <div>
            <Button
              disabled={completeFake.isPending}
              onClick={() => completeFake.mutate(pendingCheckout)}
            >
              {t('billing.fakePay')}
            </Button>
          </div>
          {completeFake.isError ? (
            <Alert>{errorMessage(completeFake.error, t('common.saveError'))}</Alert>
          ) : null}
          {completeFake.isSuccess ? (
            <Alert variant="success">{t('billing.activated')}</Alert>
          ) : null}
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3">
        <CardTitle>{t('billing.current', { plan: data.plan.name })}</CardTitle>
        {data.coveredBy ? (
          <p className="text-sm">{t('billing.coveredBy', { name: data.coveredBy })}</p>
        ) : null}
        {sub ? (
          <p className="text-sm text-muted-foreground">
            {t(sub.cancelAtPeriodEnd ? 'billing.endsOn' : 'billing.renewsOn', {
              date: formatDate(sub.currentPeriodEnd.slice(0, 10), locale),
            })}
            {sub.status === 'PAST_DUE' ? ` · ${t('billing.pastDue')}` : ''}
          </p>
        ) : null}
        <FeatureList entitlements={data.entitlements} />
        <p className="text-sm text-muted-foreground">
          {t('billing.usage', {
            used: data.usage.accounts,
            limit:
              data.entitlements.maxAccounts === null ? '∞' : String(data.entitlements.maxAccounts),
          })}
        </p>
        {sub && !sub.cancelAtPeriodEnd && sub.provider !== 'admin' ? (
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {t('billing.cancel')}
            </Button>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {data.plans.map((p) => {
          const current = p.code === data.plan.code;
          const buyable = data.checkoutEnabled && p.code !== 'FREE' && !current;
          return (
            <Card key={p.code} className="flex flex-col gap-3">
              <CardTitle>{p.name}</CardTitle>
              <p className="text-lg font-semibold">{price(p)}</p>
              <FeatureList entitlements={p.entitlements} />
              {current ? (
                <p className="text-sm font-medium">{t('billing.yourPlan')}</p>
              ) : buyable ? (
                <Button
                  disabled={checkout.isPending}
                  onClick={() =>
                    checkout.mutate(p.code, { onSuccess: (r) => window.location.assign(r.url) })
                  }
                >
                  {t('billing.choose', { plan: p.name })}
                </Button>
              ) : null}
            </Card>
          );
        })}
      </div>
      {!data.checkoutEnabled ? (
        <p className="text-sm text-muted-foreground">{t('billing.notOnSale')}</p>
      ) : null}
      {checkout.isError ? (
        <Alert>{errorMessage(checkout.error, t('common.saveError'))}</Alert>
      ) : null}
      <p className="text-xs text-muted-foreground">{t('billing.noCards')}</p>
    </div>
  );
}
