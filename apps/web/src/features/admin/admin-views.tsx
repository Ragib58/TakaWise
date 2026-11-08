'use client';

import {
  type AdminUserResponse,
  type PlanEntitlements,
  type PlanResponse,
  type PlatformRole,
  TICKET_STATUSES,
} from '@takawise/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/app/page-parts';
import { FormField } from '@/components/forms/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  useAdminAnalytics,
  useAdminFlags,
  useAdminPlans,
  useAdminRole,
  useAdminTickets,
  useAdminUserActions,
  useLookupUser,
  useSetFlag,
  useStaffReply,
  useTicketStatus,
  useUpdatePlan,
} from '../saas/queries';

/**
 * Staff console (ADR-027). English-only internal tool. The API enforces every
 * role check; this gate only avoids showing customers an empty console. There
 * is no screen — and no endpoint — for anyone's financial records.
 */

const err = (e: unknown) =>
  e instanceof ApiError ? (e.details[0]?.message ?? e.message) : 'Something went wrong.';

const NAV: Array<{ href: string; label: string; adminOnly?: boolean }> = [
  { href: '/admin', label: 'Overview', adminOnly: true },
  { href: '/admin/tickets', label: 'Tickets' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/plans', label: 'Plans', adminOnly: true },
  { href: '/admin/flags', label: 'Feature flags', adminOnly: true },
];

export function AdminGate({ children }: { children: ReactNode }) {
  const role = useAdminRole();
  const pathname = usePathname();
  if (role.isPending) return <LoadingBlock />;
  if (role.isError || role.data === 'NONE') {
    return <EmptyState title="Staff only">This area is for TakaWise staff.</EmptyState>;
  }
  const items = NAV.filter((n) => !n.adminOnly || role.data === 'ADMIN');
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Admin" className="flex flex-wrap gap-2">
        {items.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={pathname === n.href ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium',
              pathname === n.href ? 'bg-primary text-primary-foreground' : 'bg-secondary',
            )}
          >
            {n.label}
          </Link>
        ))}
        <span className="ml-auto self-center text-xs text-muted-foreground">
          Signed in as {role.data}
        </span>
      </nav>
      {children}
    </div>
  );
}

// ─────────────────────────────── Overview ───────────────────────────────

export function AdminOverview() {
  const a = useAdminAnalytics();
  if (a.isPending) return <LoadingBlock />;
  if (a.isError) return <ErrorBlock onRetry={() => void a.refetch()} />;
  const d = a.data;
  const stat = (label: string, value: number) => (
    <Card key={label} className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </Card>
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Overview" />
      <p className="text-sm text-muted-foreground">Aggregate counts only. No financial content.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stat('Users', d.users.total)}
        {stat('Active', d.users.active)}
        {stat('Verified', d.users.verified)}
        {stat('New (30 days)', d.users.newLast30Days)}
        {stat('Signed in (30 days)', d.users.signedInLast30Days)}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardTitle>Live subscriptions</CardTitle>
          <Table
            rows={d.subscriptions.map((s) => [s.planCode, String(s.live)])}
            head={['Plan', 'Live']}
          />
        </Card>
        <Card>
          <CardTitle>Family</CardTitle>
          <Table
            rows={[
              ['Workspaces', String(d.family.workspaces)],
              ['Active members', String(d.family.activeMembers)],
            ]}
            head={['', 'Count']}
          />
        </Card>
        <Card>
          <CardTitle>Tickets</CardTitle>
          <Table
            rows={d.tickets.map((t) => [t.status, String(t.count)])}
            head={['Status', 'Count']}
          />
        </Card>
      </div>
      <Card>
        <CardTitle>AI requests (30 days)</CardTitle>
        <Table
          rows={d.ai.map((r) => [r.feature, r.status, String(r.requests)])}
          head={['Feature', 'Status', 'Requests']}
        />
      </Card>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">None</p>;
  return (
    <table className="mt-2 w-full text-sm">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} className="text-left font-medium text-muted-foreground">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t">
            {r.map((c, j) => (
              <td key={j} className="py-1 tabular-nums">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─────────────────────────────── Plans ───────────────────────────────

export function AdminPlans() {
  const plans = useAdminPlans();
  if (plans.isPending) return <LoadingBlock />;
  if (plans.isError) return <ErrorBlock onRetry={() => void plans.refetch()} />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Plans" />
      <Alert>
        Prices and launch of paid plans are business and legal decisions (merchant approval, VAT,
        terms).
      </Alert>
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.data.map((p) => (
          <PlanEditor key={p.code} plan={p} />
        ))}
      </div>
    </div>
  );
}

function PlanEditor({ plan }: { plan: PlanResponse }) {
  const update = useUpdatePlan();
  const [price, setPrice] = useState(plan.priceAmount.replace(/\.?0+$/, '') || '0');
  const [active, setActive] = useState(plan.active);
  const [e, setE] = useState<PlanEntitlements>(plan.entitlements);
  const bool = (
    key: 'aiInsights' | 'aiDrafts' | 'receiptOcr' | 'familyWorkspace',
    label: string,
  ) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4"
        checked={e[key]}
        onChange={(ev) => setE({ ...e, [key]: ev.target.checked })}
      />
      {label}
    </label>
  );
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>
        {plan.name} <span className="text-xs text-muted-foreground">({plan.code})</span>
      </CardTitle>
      <FormField
        label={`Price (${plan.currency} / ${plan.interval.toLowerCase()})`}
        inputMode="decimal"
        value={price}
        onChange={(ev) => setPrice(ev.target.value)}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={active}
          onChange={(ev) => setActive(ev.target.checked)}
        />
        Purchasable
      </label>
      <FormField
        label="Max active accounts (blank = unlimited)"
        inputMode="numeric"
        value={e.maxAccounts === null ? '' : String(e.maxAccounts)}
        onChange={(ev) =>
          setE({
            ...e,
            maxAccounts:
              ev.target.value.trim() === '' ? null : Number.parseInt(ev.target.value, 10) || 1,
          })
        }
      />
      {bool('aiInsights', 'AI insights')}
      {bool('aiDrafts', 'AI transaction drafts')}
      {bool('receiptOcr', 'Receipt scanning')}
      {bool('familyWorkspace', 'Family workspace')}
      <FormField
        label="Max family members"
        inputMode="numeric"
        value={String(e.maxFamilyMembers)}
        onChange={(ev) =>
          setE({ ...e, maxFamilyMembers: Number.parseInt(ev.target.value, 10) || 2 })
        }
      />
      <div>
        <Button
          disabled={update.isPending}
          onClick={() =>
            update.mutate({
              code: plan.code,
              body: { priceAmount: price, active, entitlements: e },
            })
          }
        >
          Save
        </Button>
      </div>
      {update.isError ? <Alert>{err(update.error)}</Alert> : null}
      {update.isSuccess ? <Alert variant="success">Saved.</Alert> : null}
    </Card>
  );
}

// ─────────────────────────────── Users ───────────────────────────────

export function AdminUsers() {
  const role = useAdminRole();
  const lookup = useLookupUser();
  const actions = useAdminUserActions();
  const [email, setEmail] = useState('');
  const [user, setUser] = useState<AdminUserResponse | null>(null);
  const [plan, setPlan] = useState('PRO');
  const [months, setMonths] = useState('1');
  const isAdmin = role.data === 'ADMIN';
  const onDone = { onSuccess: (u: AdminUserResponse) => setUser(u) };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Users" />
      <p className="text-sm text-muted-foreground">
        Limited account metadata only. Balances, transactions and notes are never available to
        staff.
      </p>
      <form
        className="flex max-w-xl flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          lookup.mutate(email, onDone);
        }}
      >
        <div className="flex-1">
          <FormField
            label="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={lookup.isPending}>
          Find
        </Button>
      </form>
      {lookup.isError ? <Alert>{err(lookup.error)}</Alert> : null}
      {user ? (
        <Card className="flex max-w-xl flex-col gap-2 text-sm">
          <CardTitle>{user.name || user.email}</CardTitle>
          <dl className="grid grid-cols-2 gap-1">
            <dt className="text-muted-foreground">E-mail</dt>
            <dd>{user.email}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              {user.status} {user.emailVerified ? '(verified)' : '(unverified)'}
            </dd>
            <dt className="text-muted-foreground">Joined</dt>
            <dd>{user.createdAt.slice(0, 10)}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>{user.platformRole}</dd>
            <dt className="text-muted-foreground">Subscription</dt>
            <dd>
              {user.subscription
                ? `${user.subscription.planCode} · ${user.subscription.status} · until ${user.subscription.currentPeriodEnd.slice(0, 10)} (${user.subscription.provider})`
                : 'Free'}
            </dd>
          </dl>
          {isAdmin ? (
            <div className="mt-2 flex flex-col gap-2 border-t pt-2">
              <div className="flex flex-wrap items-end gap-2">
                <Select aria-label="Plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
                  {['PRO', 'FAMILY'].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
                <Select
                  aria-label="Months"
                  value={months}
                  onChange={(e) => setMonths(e.target.value)}
                >
                  {['1', '3', '6', '12'].map((m) => (
                    <option key={m} value={m}>
                      {m} month(s)
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  onClick={() =>
                    actions.grant.mutate(
                      {
                        id: user.id,
                        body: { planCode: plan, months: Number.parseInt(months, 10) },
                      },
                      onDone,
                    )
                  }
                >
                  Grant complimentary plan
                </Button>
                {user.subscription ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => actions.cancel.mutate(user.id, onDone)}
                  >
                    End subscription
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span>Staff role:</span>
                {(['NONE', 'SUPPORT', 'ADMIN'] as PlatformRole[]).map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={user.platformRole === r ? 'default' : 'outline'}
                    onClick={() => actions.role.mutate({ id: user.id, role: r }, onDone)}
                  >
                    {r}
                  </Button>
                ))}
              </div>
              {[actions.grant, actions.cancel, actions.role].map((m, i) =>
                m.isError ? <Alert key={i}>{err(m.error)}</Alert> : null,
              )}
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

// ─────────────────────────────── Flags ───────────────────────────────

export function AdminFlags() {
  const flags = useAdminFlags();
  const set = useSetFlag();
  if (flags.isPending) return <LoadingBlock />;
  if (flags.isError) return <ErrorBlock onRetry={() => void flags.refetch()} />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Feature flags" />
      <p className="text-sm text-muted-foreground">
        Runtime switches on top of environment configuration. Turning one off takes effect on the
        next request.
      </p>
      <ul className="flex max-w-2xl flex-col divide-y rounded-md border">
        {flags.data.map((f) => (
          <li key={f.key} className="flex items-center justify-between gap-2 p-3 text-sm">
            <span>
              <span className="font-mono">{f.key}</span>
              <span className="block text-muted-foreground">{f.description}</span>
            </span>
            <Button
              size="sm"
              variant={f.enabled ? 'default' : 'outline'}
              disabled={set.isPending}
              aria-pressed={f.enabled}
              onClick={() => set.mutate({ key: f.key, enabled: !f.enabled })}
            >
              {f.enabled ? 'On' : 'Off'}
            </Button>
          </li>
        ))}
      </ul>
      {set.isError ? <Alert>{err(set.error)}</Alert> : null}
    </div>
  );
}

// ─────────────────────────────── Tickets ───────────────────────────────

export function AdminTickets() {
  const [status, setStatus] = useState<string>('OPEN');
  const tickets = useAdminTickets(status || undefined);
  const reply = useStaffReply();
  const setTicketStatus = useTicketStatus();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Support tickets" />
      <Select
        aria-label="Status"
        className="max-w-48"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="">All</option>
        {TICKET_STATUSES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </Select>
      {tickets.isPending ? (
        <LoadingBlock />
      ) : tickets.isError ? (
        <ErrorBlock onRetry={() => void tickets.refetch()} />
      ) : tickets.data.length === 0 ? (
        <EmptyState title="No tickets" />
      ) : (
        <ul className="flex flex-col gap-3">
          {tickets.data.map((tk) => (
            <li key={tk.id}>
              <Card className="flex flex-col gap-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {tk.subject}{' '}
                    <span className="font-normal text-muted-foreground">· {tk.category}</span>
                  </span>
                  <Select
                    aria-label="Ticket status"
                    value={tk.status}
                    onChange={(e) => setTicketStatus.mutate({ id: tk.id, status: e.target.value })}
                  >
                    {TICKET_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  {tk.user.name} · {tk.user.email}
                </p>
                <ul className="flex flex-col gap-1">
                  {tk.messages.map((m) => (
                    <li key={m.id} className={m.fromStaff ? 'rounded bg-secondary/60 p-2' : 'p-2'}>
                      <span className="text-xs text-muted-foreground">
                        {m.fromStaff ? 'Staff' : 'User'} ·{' '}
                        {m.createdAt.slice(0, 16).replace('T', ' ')}
                      </span>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </li>
                  ))}
                </ul>
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const body = drafts[tk.id]?.trim();
                    if (body)
                      reply.mutate(
                        { id: tk.id, body },
                        { onSuccess: () => setDrafts((d) => ({ ...d, [tk.id]: '' })) },
                      );
                  }}
                >
                  <input
                    aria-label="Reply"
                    className="flex-1 rounded-md border bg-background px-3 py-2"
                    value={drafts[tk.id] ?? ''}
                    maxLength={4000}
                    onChange={(e) => setDrafts((d) => ({ ...d, [tk.id]: e.target.value }))}
                  />
                  <Button type="submit" size="sm" disabled={reply.isPending}>
                    Reply
                  </Button>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {reply.isError ? <Alert>{err(reply.error)}</Alert> : null}
    </div>
  );
}
