'use client';

import type { ShareResourceType, SharedResource, WorkspaceDetail } from '@takawise/contracts';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/app/page-parts';
import { useSession } from '@/components/auth/auth-provider';
import { FormField } from '@/components/forms/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { currentMonth, formatMoney } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { useAccountList } from '../finance/queries';
import { useBudgets, useGoals } from '../planning/queries';
import { errorMessage } from './billing-view';
import {
  useAcceptInvitation,
  useBilling,
  useCreateWorkspace,
  useDeleteWorkspace,
  useInvite,
  useRemoveMember,
  useRevokeInvitation,
  useShare,
  useShared,
  useUnshare,
  useWorkspace,
  useWorkspaces,
} from './queries';

/**
 * /app/family (ADR-026): workspaces, invitations by code, and explicit,
 * per-item sharing. Joining shares nothing; every shared item is listed with
 * who shared it and can be withdrawn.
 */
export function FamilyView() {
  const t = useT();
  const workspaces = useWorkspaces();
  const billing = useBilling();
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected ?? workspaces.data?.[0]?.id ?? null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('family.title')} />
      <p className="text-sm text-muted-foreground">{t('family.intro')}</p>
      {workspaces.isPending || billing.isPending ? (
        <LoadingBlock />
      ) : workspaces.isError ? (
        <ErrorBlock onRetry={() => void workspaces.refetch()} />
      ) : (
        <>
          {workspaces.data.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {workspaces.data.map((w) => (
                <Button
                  key={w.id}
                  size="sm"
                  variant={w.id === active ? 'default' : 'outline'}
                  onClick={() => setSelected(w.id)}
                >
                  {w.name}
                </Button>
              ))}
            </div>
          ) : null}
          {active ? <Workspace id={active} /> : null}
          <div className="grid gap-4 md:grid-cols-2">
            <AcceptCard />
            {!workspaces.data.some((w) => w.myRole === 'OWNER') ? (
              billing.data?.entitlements.familyWorkspace ? (
                <CreateCard />
              ) : (
                <Card className="flex flex-col gap-2">
                  <CardTitle>{t('family.create')}</CardTitle>
                  <p className="text-sm text-muted-foreground">{t('family.needsPlan')}</p>
                  <Link href="/app/billing" className="text-sm underline">
                    {t('nav.billing')}
                  </Link>
                </Card>
              )
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function CreateCard() {
  const t = useT();
  const create = useCreateWorkspace();
  const [name, setName] = useState('');
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t('family.create')}</CardTitle>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(name.trim());
        }}
      >
        <FormField
          label={t('family.name')}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <div>
          <Button type="submit" disabled={create.isPending}>
            {t('family.create')}
          </Button>
        </div>
        {create.isError ? <Alert>{errorMessage(create.error, t('common.saveError'))}</Alert> : null}
      </form>
    </Card>
  );
}

function AcceptCard() {
  const t = useT();
  const accept = useAcceptInvitation();
  const [code, setCode] = useState('');
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t('family.join')}</CardTitle>
      <p className="text-sm text-muted-foreground">{t('family.joinHint')}</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          accept.mutate(code, { onSuccess: () => setCode('') });
        }}
      >
        <FormField
          label={t('family.code')}
          value={code}
          autoComplete="one-time-code"
          maxLength={10}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <div>
          <Button type="submit" disabled={accept.isPending || code.trim().length !== 10}>
            {t('family.joinButton')}
          </Button>
        </div>
        {accept.isError ? <Alert>{errorMessage(accept.error, t('common.saveError'))}</Alert> : null}
        {accept.isSuccess ? (
          <Alert variant="success">{t('family.joined', { name: accept.data.name })}</Alert>
        ) : null}
      </form>
    </Card>
  );
}

function Workspace({ id }: { id: string }) {
  const t = useT();
  const session = useSession();
  const detail = useWorkspace(id);
  const shared = useShared(id);
  const invite = useInvite(id);
  const revoke = useRevokeInvitation(id);
  const remove = useRemoveMember(id);
  const unshare = useUnshare(id);
  const del = useDeleteWorkspace();
  const [email, setEmail] = useState('');

  if (detail.isPending) return <LoadingBlock />;
  if (detail.isError) return <ErrorBlock onRetry={() => void detail.refetch()} />;
  const ws: WorkspaceDetail = detail.data;
  const manager = ws.myRole === 'OWNER' || ws.myRole === 'ADMIN';
  const meId = session.status === 'authenticated' ? session.user.id : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <CardTitle className="flex items-center gap-2">
          <Users aria-hidden className="size-4" /> {ws.name}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('family.members', { count: ws.memberCount, max: ws.maxMembers })} ·{' '}
          {t(`family.role.${ws.myRole}`)}
        </p>
        <ul className="flex flex-col divide-y">
          {ws.members.map((m) => (
            <li
              key={m.userId}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span>
                <span className="font-medium">{m.name}</span> · {m.email} ·{' '}
                {t(`family.role.${m.role}`)}
              </span>
              {m.role !== 'OWNER' && (manager || m.userId === meId) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(m.userId)}
                >
                  {m.userId === meId ? t('family.leave') : t('family.remove')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {remove.isError ? <Alert>{errorMessage(remove.error, t('common.saveError'))}</Alert> : null}

        {manager ? (
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate({ email, role: 'MEMBER' }, { onSuccess: () => setEmail('') });
            }}
          >
            <div className="flex-1">
              <FormField
                label={t('family.inviteEmail')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={invite.isPending || !email}>
              {t('family.invite')}
            </Button>
          </form>
        ) : null}
        {invite.isError ? <Alert>{errorMessage(invite.error, t('common.saveError'))}</Alert> : null}
        {invite.isSuccess ? <Alert variant="success">{t('family.invited')}</Alert> : null}
        {ws.invitations.length > 0 ? (
          <ul className="text-sm">
            {ws.invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-1">
                <span>
                  {i.email} · {t('family.pending')}
                </span>
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>
                  {t('family.cancelInvite')}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {ws.myRole === 'OWNER' ? (
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (window.confirm(t('family.deleteConfirm'))) del.mutate(ws.id);
              }}
            >
              {t('family.delete')}
            </Button>
          </div>
        ) : null}
      </Card>

      <ShareCard
        workspace={ws}
        meId={meId ?? null}
        onUnshare={(shareId) => unshare.mutate(shareId)}
      />

      <Card className="flex flex-col gap-3">
        <CardTitle>{t('family.sharedWithFamily')}</CardTitle>
        {shared.isPending ? (
          <LoadingBlock />
        ) : shared.isError ? (
          <ErrorBlock onRetry={() => void shared.refetch()} />
        ) : shared.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('family.nothingShared')}</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {shared.data.map((r) => (
              <SharedCard key={r.shareId} resource={r} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function SharedCard({ resource: r }: { resource: SharedResource }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <li className="rounded-md border p-3 text-sm">
      <p className="font-medium">{r.name}</p>
      <p className="text-xs text-muted-foreground">
        {t(`family.type.${r.resourceType}`)} · {t('family.sharedBy', { name: r.sharedBy })}
      </p>
      {r.resourceType === 'ACCOUNT' ? (
        <p className="mt-1 tabular-nums">{formatMoney(r.balance, r.currency, locale)}</p>
      ) : r.resourceType === 'BUDGET' ? (
        <p className="mt-1 tabular-nums">
          {formatMoney(r.spent, r.currency, locale)}
          {r.limit ? ` / ${formatMoney(r.limit, r.currency, locale)}` : ''}
        </p>
      ) : (
        <p className="mt-1 tabular-nums">
          {formatMoney(r.saved, r.currency, locale)} /{' '}
          {formatMoney(r.targetAmount, r.currency, locale)} ({r.percent}%)
        </p>
      )}
    </li>
  );
}

function ShareCard({
  workspace,
  meId,
  onUnshare,
}: {
  workspace: WorkspaceDetail;
  meId: string | null;
  onUnshare: (shareId: string) => void;
}) {
  const t = useT();
  const { timeZone } = useLocale();
  const share = useShare(workspace.id);
  const accounts = useAccountList('ACTIVE');
  const budgets = useBudgets(currentMonth(timeZone));
  const goals = useGoals();
  const [type, setType] = useState<ShareResourceType>('ACCOUNT');
  const [resourceId, setResourceId] = useState('');
  const mine = workspace.shares.filter((s) => s.sharedBy.userId === meId);

  const options =
    type === 'ACCOUNT'
      ? (accounts.data ?? []).map((a) => ({ id: a.id, name: a.name }))
      : type === 'BUDGET'
        ? (budgets.data ?? []).map((b) => ({ id: b.id, name: b.name }))
        : (goals.data ?? []).map((g) => ({ id: g.id, name: g.name }));
  const nameOf = (resourceIdToFind: string) =>
    [...(accounts.data ?? []), ...(budgets.data ?? []), ...(goals.data ?? [])].find(
      (x) => x.id === resourceIdToFind,
    )?.name ?? '—';

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t('family.myShares')}</CardTitle>
      <p className="text-sm text-muted-foreground">{t('family.shareHint')}</p>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (resourceId)
            share.mutate(
              { resourceType: type, resourceId },
              { onSuccess: () => setResourceId('') },
            );
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="share-type">{t('family.shareType')}</Label>
          <Select
            id="share-type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as ShareResourceType);
              setResourceId('');
            }}
          >
            {(['ACCOUNT', 'BUDGET', 'GOAL'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`family.type.${v}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="share-item">{t('family.shareItem')}</Label>
          <Select
            id="share-item"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
          >
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={share.isPending || !resourceId}>
          {t('family.share')}
        </Button>
      </form>
      {share.isError ? <Alert>{errorMessage(share.error, t('common.saveError'))}</Alert> : null}
      {mine.length > 0 ? (
        <ul className="text-sm">
          {mine.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-1">
              <span>
                {t(`family.type.${s.resourceType}`)}: {nameOf(s.resourceId)}
              </span>
              <Button size="sm" variant="ghost" onClick={() => onUnshare(s.id)}>
                {t('family.stopSharing')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
