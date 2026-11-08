'use client';

import { TICKET_CATEGORIES } from '@takawise/contracts';
import { useState } from 'react';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/app/page-parts';
import { FormField } from '@/components/forms/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatDateTime } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { errorMessage } from './billing-view';
import { useCreateTicket, useMyTickets, useReplyTicket } from './queries';

/** /app/support: tickets the user writes; staff never see anything else of theirs. */
export function SupportView() {
  const t = useT();
  const { locale, timeZone } = useLocale();
  const tickets = useMyTickets();
  const create = useCreateTicket();
  const reply = useReplyTicket();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<(typeof TICKET_CATEGORIES)[number]>('OTHER');
  const [body, setBody] = useState('');
  const [replies, setReplies] = useState<Record<string, string>>({});

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('support.title')} />
      <Card className="flex max-w-xl flex-col gap-3">
        <CardTitle>{t('support.new')}</CardTitle>
        <Alert>{t('support.noSecrets')}</Alert>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              { subject, category, body },
              {
                onSuccess: () => {
                  setSubject('');
                  setBody('');
                },
              },
            );
          }}
        >
          <FormField
            label={t('support.subject')}
            value={subject}
            maxLength={150}
            onChange={(e) => setSubject(e.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ticket-category">{t('support.category')}</Label>
            <Select
              id="ticket-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as (typeof TICKET_CATEGORIES)[number])}
            >
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`support.category.${c}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ticket-body">{t('support.message')}</Label>
            <textarea
              id="ticket-body"
              className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm"
              maxLength={4000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div>
            <Button
              type="submit"
              disabled={create.isPending || subject.trim().length < 3 || !body.trim()}
            >
              {t('support.send')}
            </Button>
          </div>
          {create.isError ? (
            <Alert>{errorMessage(create.error, t('common.saveError'))}</Alert>
          ) : null}
          {create.isSuccess ? <Alert variant="success">{t('support.sent')}</Alert> : null}
        </form>
      </Card>

      {tickets.isPending ? (
        <LoadingBlock />
      ) : tickets.isError ? (
        <ErrorBlock onRetry={() => void tickets.refetch()} />
      ) : tickets.data.length === 0 ? (
        <EmptyState title={t('support.empty')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {tickets.data.map((ticket) => (
            <li key={ticket.id}>
              <Card className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">{ticket.subject}</h2>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                    {t(`support.status.${ticket.status}`)}
                  </span>
                </div>
                <ul className="flex flex-col gap-2 text-sm">
                  {ticket.messages.map((m) => (
                    <li
                      key={m.id}
                      className={m.fromStaff ? 'rounded-md bg-secondary/60 p-2' : 'p-2'}
                    >
                      <p className="text-xs text-muted-foreground">
                        {m.fromStaff ? t('support.fromStaff') : t('support.fromYou')} ·{' '}
                        {formatDateTime(m.createdAt, timeZone, locale)}
                      </p>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </li>
                  ))}
                </ul>
                {ticket.status !== 'CLOSED' ? (
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const text = replies[ticket.id]?.trim();
                      if (text)
                        reply.mutate(
                          { id: ticket.id, body: text },
                          { onSuccess: () => setReplies((r) => ({ ...r, [ticket.id]: '' })) },
                        );
                    }}
                  >
                    <label className="sr-only" htmlFor={`reply-${ticket.id}`}>
                      {t('support.reply')}
                    </label>
                    <input
                      id={`reply-${ticket.id}`}
                      className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                      value={replies[ticket.id] ?? ''}
                      maxLength={4000}
                      onChange={(e) => setReplies((r) => ({ ...r, [ticket.id]: e.target.value }))}
                    />
                    <Button type="submit" size="sm" disabled={reply.isPending}>
                      {t('support.reply')}
                    </Button>
                  </form>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
