'use client';

import { Bell, Check, X } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/components/auth/auth-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n/use-t';
import { cn } from '@/lib/utils';
import {
  useCreateReminder,
  useMarkRead,
  useNotifications,
  useReminderAction,
  useReminders,
} from './queries';

const VIEWS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past_due', label: 'Past due' },
  { id: 'done', label: 'Done' },
] as const;

export function RemindersView() {
  const session = useSession();
  const t = useT();
  const locale = session.status === 'authenticated' ? session.user.profile.locale : 'en';
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('upcoming');
  const reminders = useReminders(view);
  const action = useReminderAction();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('nav.reminders')}</h1>
      <div
        role="tablist"
        aria-label="Reminder views"
        className="flex gap-1 rounded-lg bg-secondary p-1"
      >
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            type="button"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium',
              view === v.id ? 'bg-card shadow-xs' : 'text-muted-foreground',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {reminders.isPending ? (
        <div
          role="status"
          className="h-24 animate-pulse rounded-lg bg-secondary"
          aria-label="Loading reminders"
        />
      ) : reminders.isError ? (
        <Alert>Could not load reminders.</Alert>
      ) : reminders.data.length === 0 ? (
        <EmptyState title="Nothing here">
          Add bill and payment reminders, e.g. rent, DESCO or internet.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {reminders.data.map((r) => (
            <li key={r.id}>
              <Card className="flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="font-medium">{r.title}</p>
                  <p
                    className={cn(
                      'text-xs',
                      r.pastDue ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {r.pastDue ? 'Past due · ' : ''}
                    {formatDateTime(r.dueAt, r.timezone, locale)}
                  </p>
                  {r.notes ? <p className="text-sm text-muted-foreground">{r.notes}</p> : null}
                </div>
                {r.status === 'PENDING' ? (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() => action.mutate({ id: r.id, action: 'complete' })}
                    >
                      <Check aria-hidden /> Done
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Cancel ${r.title}`}
                      disabled={action.isPending}
                      onClick={() => action.mutate({ id: r.id, action: 'cancel' })}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {r.status === 'DONE' ? 'Done' : 'Cancelled'}
                  </span>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <CreateReminderForm />
    </div>
  );
}

function CreateReminderForm() {
  const create = useCreateReminder();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title || !due) {
      setError('Enter a title and a due date and time.');
      return;
    }
    setError(null);
    try {
      // datetime-local is in the browser's zone; send an absolute instant.
      await create.mutateAsync({
        title,
        dueAt: new Date(due).toISOString(),
        ...(notes ? { notes } : {}),
      });
      setTitle('');
      setDue('');
      setNotes('');
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.details[0]?.message ?? e.message)
          : 'Could not save the reminder.',
      );
    }
  }

  return (
    <Card>
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3" noValidate>
        <CardTitle>New reminder</CardTitle>
        {error ? <Alert>{error}</Alert> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reminder-title">Title</Label>
          <Input
            id="reminder-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Pay DESCO bill"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reminder-due">Due</Label>
          <Input
            id="reminder-due"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reminder-notes">Notes (optional)</Label>
          <Input id="reminder-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Add reminder'}
        </Button>
      </form>
    </Card>
  );
}

export function NotificationsView() {
  const session = useSession();
  const t = useT();
  const locale = session.status === 'authenticated' ? session.user.profile.locale : 'en';
  const timezone =
    session.status === 'authenticated' ? session.user.profile.timezone : 'Asia/Dhaka';
  const notifications = useNotifications();
  const markRead = useMarkRead();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('nav.notifications')}</h1>
        <Button
          variant="outline"
          size="sm"
          disabled={markRead.isPending}
          onClick={() => markRead.mutate('all')}
        >
          Mark all read
        </Button>
      </div>
      {notifications.isPending ? (
        <div
          role="status"
          className="h-24 animate-pulse rounded-lg bg-secondary"
          aria-label="Loading notifications"
        />
      ) : notifications.isError ? (
        <Alert>Could not load notifications.</Alert>
      ) : notifications.data.length === 0 ? (
        <EmptyState title="You're all caught up" />
      ) : (
        <ul className="flex flex-col gap-2">
          {notifications.data.map((n) => (
            <li key={n.id}>
              <Card
                className={cn(
                  'flex items-center justify-between gap-3 p-3',
                  !n.readAt && 'border-brand-teal/50',
                )}
              >
                <div className="flex items-start gap-2">
                  <Bell aria-hidden className="mt-0.5 size-4 text-brand-teal" />
                  <div>
                    <p className="font-medium">
                      {!n.readAt ? <span className="sr-only">Unread: </span> : null}
                      {n.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(n.createdAt, timezone, locale)}
                    </p>
                  </div>
                </div>
                {!n.readAt ? (
                  <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)}>
                    Mark read
                  </Button>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
