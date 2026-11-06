'use client';

import { Filter, Plus, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/app/page-parts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { useCategories } from '../planning/queries';
import {
  type TransactionFilters,
  useAccountList,
  useReverseTransaction,
  useTransactionList,
} from './queries';
import { TransactionRow } from './transaction-row';

const EMPTY: TransactionFilters = { page: 1 };

export function TransactionsView() {
  const t = useT();
  const { locale } = useLocale();
  const [filters, setFilters] = useState<TransactionFilters>(EMPTY);
  const [draft, setDraft] = useState<TransactionFilters>(EMPTY);
  const [showFilters, setShowFilters] = useState(false);
  const list = useTransactionList(filters);
  const accounts = useAccountList('ALL');
  const categories = useCategories();
  const reverse = useReverseTransaction();
  const [error, setError] = useState<string | null>(null);

  async function onReverse(id: string) {
    if (!window.confirm(t('transactions.reverseConfirm'))) return;
    setError(null);
    try {
      await reverse.mutateAsync({ id, key: crypto.randomUUID() });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.saveError'));
    }
  }

  const set = (patch: Partial<TransactionFilters>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('transactions.title')}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={showFilters}
              aria-controls="transaction-filters"
              onClick={() => setShowFilters((s) => !s)}
            >
              <Filter aria-hidden /> {t('transactions.filters')}
            </Button>
            <Button asChild size="sm">
              <Link href="/app/transactions/new">
                <Plus aria-hidden /> {t('transactions.add')}
              </Link>
            </Button>
          </>
        }
      />

      {showFilters ? (
        <Card id="transaction-filters">
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              setFilters({ ...draft, page: 1 });
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-q">{t('transactions.search')}</Label>
              <Input
                id="f-q"
                value={draft.q ?? ''}
                onChange={(e) => set({ q: e.target.value || undefined })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-type">{t('transactions.type')}</Label>
              <Select
                id="f-type"
                value={draft.type ?? ''}
                onChange={(e) =>
                  set({ type: (e.target.value || undefined) as TransactionFilters['type'] })
                }
              >
                <option value="">{t('common.all')}</option>
                <option value="INCOME">{t('common.income')}</option>
                <option value="EXPENSE">{t('common.expense')}</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-account">{t('common.account')}</Label>
              <Select
                id="f-account"
                value={draft.accountId ?? ''}
                onChange={(e) => set({ accountId: e.target.value || undefined })}
              >
                <option value="">{t('common.all')}</option>
                {(accounts.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-category">{t('common.category')}</Label>
              <Select
                id="f-category"
                value={draft.categoryId ?? ''}
                onChange={(e) => set({ categoryId: e.target.value || undefined })}
              >
                <option value="">{t('common.all')}</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {locale === 'bn' ? c.nameBn : c.nameEn}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-from">{t('common.from')}</Label>
              <Input
                id="f-from"
                type="date"
                value={draft.from ?? ''}
                onChange={(e) => set({ from: e.target.value || undefined })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-to">{t('common.to')}</Label>
              <Input
                id="f-to"
                type="date"
                value={draft.to ?? ''}
                onChange={(e) => set({ to: e.target.value || undefined })}
              />
            </div>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit">{t('common.apply')}</Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraft(EMPTY);
                  setFilters(EMPTY);
                }}
              >
                {t('common.reset')}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {error ? <Alert>{error}</Alert> : null}

      {list.isPending ? (
        <LoadingBlock className="h-64" />
      ) : list.isError ? (
        <ErrorBlock onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title={t('transactions.empty')} />
      ) : (
        <Card>
          <ul className="divide-y">
            {list.data.items.map((trx) => (
              <TransactionRow
                key={trx.id}
                trx={trx}
                actions={
                  trx.status === 'POSTED' ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t('transactions.reverse')}: ${trx.description ?? trx.category.nameEn}`}
                      disabled={reverse.isPending}
                      onClick={() => void onReverse(trx.id)}
                    >
                      <Undo2 aria-hidden />
                    </Button>
                  ) : null
                }
              />
            ))}
          </ul>
          <nav className="flex items-center justify-between pt-3 text-sm" aria-label="Pagination">
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page <= 1}
              onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
            >
              {t('transactions.previous')}
            </Button>
            <span>
              {t('transactions.page', {
                page: list.data.meta.page,
                pages: Math.max(1, list.data.meta.totalPages),
              })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page >= list.data.meta.totalPages}
              onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
            >
              {t('transactions.next')}
            </Button>
          </nav>
        </Card>
      )}
    </div>
  );
}
