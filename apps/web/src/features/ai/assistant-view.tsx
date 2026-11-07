'use client';

import {
  AI_CONSENT_SCOPES,
  AI_DATA_SCOPES,
  type AiConsentScope,
  type AiDataScope,
  type AiStatusResponse,
  type DraftResponse,
  INSIGHT_KINDS,
  type InsightKind,
  type InsightResponse,
} from '@takawise/contracts';
import { Camera, MessageSquareText, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { ErrorBlock, LoadingBlock, MonthPicker, PageHeader } from '@/components/app/page-parts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { currentMonth, formatDate } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { cn } from '@/lib/utils';
import { NewTransactionForm } from '../finance/new-transaction-form';
import { useAccountList } from '../finance/queries';
import { useCategories } from '../planning/queries';
import { aiErrorText, formatFact, Narrative } from './insight-parts';
import {
  useAiStatus,
  useDeleteAiData,
  useInsight,
  useReceiptDraft,
  useSetConsent,
  useTextDraft,
} from './queries';

/**
 * /app/assistant (blueprint §9.3): consent and data-scope controls, insights
 * that explain backend-computed facts, and drafts that the user reviews in the
 * normal transaction form before anything is saved.
 */
export function AssistantView() {
  const t = useT();
  const status = useAiStatus();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('ai.title')} />
      <p className="text-sm text-muted-foreground">{t('ai.intro')}</p>
      <AiDisclaimer />
      {status.isPending ? (
        <LoadingBlock />
      ) : status.isError ? (
        <ErrorBlock onRetry={() => void status.refetch()} />
      ) : !status.data.enabled ? (
        <EmptyState title={t('ai.disabled')} />
      ) : (
        <>
          <PrivacyCard status={status.data} />
          <InsightsCard status={status.data} />
          <TextDraftCard status={status.data} />
          <ReceiptCard status={status.data} />
        </>
      )}
    </div>
  );
}

function AiDisclaimer() {
  const t = useT();
  return (
    <p className="flex items-start gap-2 rounded-md border bg-secondary/40 p-3 text-xs text-muted-foreground">
      <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{t('ai.disclaimer')}</span>
    </p>
  );
}

const granted = (status: AiStatusResponse, scope: AiConsentScope) =>
  status.consents.find((c) => c.scope === scope)?.granted ?? false;

// ─────────────────────────────── Privacy ───────────────────────────────

function PrivacyCard({ status }: { status: AiStatusResponse }) {
  const t = useT();
  const { locale } = useLocale();
  const setConsent = useSetConsent();
  const deleteData = useDeleteAiData();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t('ai.privacy')}</CardTitle>
      <p className="text-sm text-muted-foreground">{t('ai.privacyHint')}</p>
      {setConsent.isError ? <Alert>{aiErrorText(setConsent.error, t)}</Alert> : null}
      <ul className="flex flex-col divide-y">
        {AI_CONSENT_SCOPES.map((scope) => {
          const on = granted(status, scope);
          const consent = status.consents.find((c) => c.scope === scope);
          return (
            <li
              key={scope}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <span className="font-medium">
                  {t(`ai.scope.${scope}`)}{' '}
                  <span
                    className={cn(
                      'ml-1 rounded-full px-2 py-0.5 text-xs',
                      on ? 'bg-positive/10 text-positive' : 'bg-secondary text-muted-foreground',
                    )}
                  >
                    {on ? t('ai.consent.on') : t('ai.consent.off')}
                  </span>
                </span>
                <span className="text-sm text-muted-foreground">
                  {t(`ai.scope.${scope}.shares`)}
                </span>
                {on && consent?.grantedAt ? (
                  <span className="text-xs text-muted-foreground">
                    {formatDate(consent.grantedAt.slice(0, 10), locale)}
                  </span>
                ) : null}
              </div>
              <Button
                size="sm"
                variant={on ? 'outline' : 'default'}
                disabled={setConsent.isPending}
                onClick={() => setConsent.mutate({ scope, granted: !on })}
                aria-label={`${on ? t('ai.consent.turnOff') : t('ai.consent.allow')}: ${t(`ai.scope.${scope}`)}`}
              >
                {on ? t('ai.consent.turnOff') : t('ai.consent.allow')}
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
        <span className="text-muted-foreground">
          {t('ai.usage', {
            requests: status.usage.requestsToday,
            limit: status.usage.dailyRequestLimit,
          })}
          {status.provider
            ? ` · ${t('ai.provider', { provider: status.provider, model: status.model ?? '' })}`
            : ''}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={deleteData.isPending}
          onClick={() => {
            if (!window.confirm(t('ai.deleteConfirm'))) return;
            deleteData.mutate(undefined, {
              onSuccess: (r) => setMessage(t('ai.deleted', { count: r.insightsDeleted })),
            });
          }}
        >
          {t('ai.deleteData')}
        </Button>
      </div>
      {message ? <Alert variant="success">{message}</Alert> : null}
    </Card>
  );
}

// ─────────────────────────────── Insights ───────────────────────────────

function InsightsCard({ status }: { status: AiStatusResponse }) {
  const t = useT();
  const { locale, timeZone } = useLocale();
  const [kind, setKind] = useState<InsightKind>('MONTHLY_SUMMARY');
  const [month, setMonth] = useState(() => currentMonth(timeZone));
  const [include, setInclude] = useState<AiDataScope[]>([...AI_DATA_SCOPES]);
  const insight = useInsight();
  const kinds = INSIGHT_KINDS.filter((k) => status.features.includes(k));
  if (kinds.length === 0) return null;
  const allowed = granted(status, 'INSIGHTS');

  const run = (refresh: boolean) => insight.mutate({ kind, month, include, locale, refresh });

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle className="flex items-center gap-2">
        <Sparkles aria-hidden className="size-4" /> {t('ai.insights')}
      </CardTitle>
      {!allowed ? (
        <p className="text-sm text-muted-foreground">{t('ai.needsConsent')}</p>
      ) : (
        <>
          <div
            className="grid grid-cols-1 gap-1 rounded-lg bg-secondary p-1 sm:grid-cols-3"
            role="radiogroup"
          >
            {kinds.map((k) => (
              <label
                key={k}
                className={cn(
                  'cursor-pointer rounded-md px-3 py-1.5 text-center text-sm font-medium',
                  kind === k ? 'bg-card shadow-xs' : 'text-muted-foreground',
                )}
              >
                <input
                  type="radio"
                  name="insight-kind"
                  className="sr-only"
                  checked={kind === k}
                  onChange={() => setKind(k)}
                />
                {t(`ai.kind.${k}`)}
              </label>
            ))}
          </div>
          <MonthPicker month={month} onChange={setMonth} />
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <legend className="mb-1 text-sm font-medium">{t('ai.alsoShare')}</legend>
            {AI_DATA_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={include.includes(scope)}
                  onChange={(e) =>
                    setInclude((prev) =>
                      e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope),
                    )
                  }
                />
                {t(`ai.dataScope.${scope}`)}
              </label>
            ))}
          </fieldset>
          <div>
            <Button onClick={() => run(false)} disabled={insight.isPending}>
              {insight.isPending ? t('ai.thinking') : t('ai.explain')}
            </Button>
          </div>
          {insight.isError ? <Alert>{aiErrorText(insight.error, t)}</Alert> : null}
          {insight.data ? (
            <InsightResult data={insight.data} onAgain={() => run(true)} busy={insight.isPending} />
          ) : null}
        </>
      )}
    </Card>
  );
}

export function InsightResult({
  data,
  onAgain,
  busy,
}: {
  data: InsightResponse;
  onAgain?: () => void;
  busy?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const extra = data.dataScope.map((s) => `, ${t(`ai.dataScope.${s}`).toLowerCase()}`).join('');

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3" aria-live="polite">
      <p className="text-xs text-muted-foreground">
        {t(`ai.kind.${data.kind}`)} ·{' '}
        {t('ai.period', {
          from: formatDate(data.periodStart, locale),
          to: formatDate(data.periodEnd, locale),
          currency: data.currency,
        })}
      </p>
      {data.status !== 'READY' ? (
        <p className="text-sm">{t(`ai.status.${data.status}`)}</p>
      ) : (
        <>
          <p className="font-medium">
            <Narrative
              segments={data.headline}
              facts={data.facts}
              currency={data.currency}
              locale={locale}
            />
          </p>
          {data.points.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {data.points.map((p, i) => (
                <li key={i}>
                  <Narrative
                    segments={p}
                    facts={data.facts}
                    currency={data.currency}
                    locale={locale}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {data.cached ? <p className="text-xs text-muted-foreground">{t('ai.cached')}</p> : null}
        </>
      )}
      <div className="text-xs text-muted-foreground">
        <p className="font-medium">{t('ai.limitations')}</p>
        <ul className="list-disc pl-5">
          {data.limitations.map((l) => (
            <li key={l}>{t(`ai.limitation.${l}`, { currency: data.currency })}</li>
          ))}
        </ul>
        {data.status === 'READY' ? <p className="mt-1">{t('ai.shared', { extra })}</p> : null}
      </div>
      {data.facts.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t('ai.factsUsed')}</summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {data.facts.map((f) => (
              <div key={f.id} className="flex justify-between gap-2 border-b py-1">
                <dt className="text-muted-foreground">{locale === 'bn' ? f.labelBn : f.labelEn}</dt>
                <dd className="tabular-nums">{formatFact(f, data.currency, locale)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      {data.status === 'READY' && onAgain ? (
        <div>
          <Button size="sm" variant="ghost" onClick={onAgain} disabled={busy}>
            {t('ai.askAgain')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────── Drafts ───────────────────────────────

function TextDraftCard({ status }: { status: AiStatusResponse }) {
  const t = useT();
  const { locale } = useLocale();
  const [text, setText] = useState('');
  const draft = useTextDraft();
  if (!status.features.includes('TRANSACTION_DRAFT')) return null;
  const allowed = granted(status, 'TRANSACTION_DRAFT');

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle className="flex items-center gap-2">
        <MessageSquareText aria-hidden className="size-4" /> {t('ai.draft.title')}
      </CardTitle>
      {!allowed ? (
        <p className="text-sm text-muted-foreground">{t('ai.needsConsent')}</p>
      ) : (
        <>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim().length >= 3) draft.mutate({ text, locale });
            }}
          >
            <Label htmlFor="ai-draft-text">{t('ai.draft.label')}</Label>
            <textarea
              id="ai-draft-text"
              className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm"
              maxLength={300}
              placeholder={t('ai.draft.placeholder')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div>
              <Button type="submit" disabled={draft.isPending || text.trim().length < 3}>
                {draft.isPending ? t('ai.thinking') : t('ai.draft.submit')}
              </Button>
            </div>
          </form>
          {draft.isError ? <Alert>{aiErrorText(draft.error, t)}</Alert> : null}
          {draft.data ? <DraftReview data={draft.data} onDiscard={() => draft.reset()} /> : null}
        </>
      )}
    </Card>
  );
}

function ReceiptCard({ status }: { status: AiStatusResponse }) {
  const t = useT();
  const { locale } = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const receipt = useReceiptDraft();
  if (!status.features.includes('RECEIPT_OCR')) return null;
  const allowed = granted(status, 'RECEIPT_OCR');
  const maxMb = (status.receiptMaxBytes / 1_000_000).toFixed(0);

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle className="flex items-center gap-2">
        <Camera aria-hidden className="size-4" /> {t('ai.receipt.title')}
      </CardTitle>
      {!allowed ? (
        <p className="text-sm text-muted-foreground">{t('ai.needsConsent')}</p>
      ) : (
        <>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (file) receipt.mutate({ file, locale });
            }}
          >
            <Label htmlFor="ai-receipt">{t('ai.receipt.choose', { size: maxMb })}</Label>
            <input
              id="ai-receipt"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <div>
              <Button type="submit" disabled={!file || receipt.isPending}>
                {receipt.isPending ? t('ai.thinking') : t('ai.receipt.submit')}
              </Button>
            </div>
          </form>
          {receipt.isError ? <Alert>{aiErrorText(receipt.error, t)}</Alert> : null}
          {receipt.data ? (
            <DraftReview data={receipt.data} onDiscard={() => receipt.reset()} />
          ) : null}
        </>
      )}
    </Card>
  );
}

/** Draft → the normal transaction form, pre-filled. Saving is the user's explicit act. */
export function DraftReview({ data, onDiscard }: { data: DraftResponse; onDiscard: () => void }) {
  const t = useT();
  const accounts = useAccountList('ACTIVE');
  const categories = useCategories();
  const { draft } = data;

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <Alert variant="success">{t('ai.draft.review')}</Alert>
      {draft.missing.length > 0 ? (
        <p className="text-sm">
          {t('ai.draft.missing', {
            fields: draft.missing.map((f) => t(`ai.draft.field.${f}`)).join(', '),
          })}
        </p>
      ) : null}
      {draft.warnings.map((w) => (
        <Alert key={w}>{t(`ai.draft.warning.${w}`)}</Alert>
      ))}
      {data.merchant ? (
        <p className="text-sm">{t('ai.receipt.merchant', { name: data.merchant })}</p>
      ) : null}
      {data.lineItems.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {t('ai.receipt.items')}
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {data.lineItems.map((item, i) => (
              <li key={i}>
                {item.description}
                {item.amount ? ` — ${item.amount}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {accounts.isPending || categories.isPending ? (
        <LoadingBlock />
      ) : (
        <NewTransactionForm
          // A new draft remounts the form with fresh defaults and a fresh idempotency key.
          key={JSON.stringify(draft)}
          embedded
          initial={draft}
        />
      )}
      <div>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          {t('ai.draft.discard')}
        </Button>
      </div>
    </div>
  );
}
