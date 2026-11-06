'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordRequestSchema, isValidTimeZone } from '@takawise/contracts';
import { LogOut, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useSession } from '@/components/auth/auth-provider';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/app/page-parts';
import { FormField } from '@/components/forms/form-field';
import { useApiFormError } from '@/components/forms/use-api-form-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { authedRequest } from '@/lib/auth/auth-api';
import { setSession } from '@/lib/auth/session-store';
import { formatDateTime } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/use-t';
import { cn } from '@/lib/utils';
import { useChangePassword, useRevokeSession, useSessions, useUpdateMe } from './queries';

const TABS = [
  { href: '/app/settings/profile', key: 'settings.profile' },
  { href: '/app/settings/preferences', key: 'settings.preferences' },
  { href: '/app/settings/security', key: 'settings.security' },
] as const;

function SettingsTabs() {
  const t = useT();
  const pathname = usePathname();
  return (
    <nav aria-label={t('settings.title')} className="flex gap-1 rounded-lg bg-secondary p-1">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? 'page' : undefined}
          className={cn(
            'flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium',
            pathname === tab.href ? 'bg-card shadow-xs' : 'text-muted-foreground',
          )}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}

export function ProfileSettings() {
  const t = useT();
  const session = useSession();
  const update = useUpdateMe();
  const [name, setName] = useState(
    session.status === 'authenticated' ? session.user.profile.fullName : '',
  );
  const [saved, setSaved] = useState(false);
  if (session.status !== 'authenticated') return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    await update.mutateAsync({ fullName: name });
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('settings.title')} />
      <SettingsTabs />
      <Card className="max-w-xl">
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3">
          <CardTitle>{t('settings.profile')}</CardTitle>
          {saved ? <Alert variant="success">{t('settings.saved')}</Alert> : null}
          {update.isError ? <Alert>{t('common.saveError')}</Alert> : null}
          <FormField
            label={t('settings.fullName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <FormField label={t('settings.email')} value={session.user.email} readOnly disabled />
          <Button type="submit" disabled={update.isPending || !name.trim()}>
            {update.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </form>
      </Card>
    </div>
  );
}

const TIME_ZONES = [
  'Asia/Dhaka',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Kuala_Lumpur',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'UTC',
];

export function PreferencesSettings() {
  const t = useT();
  const { locale, timeZone, currency } = useLocale();
  const update = useUpdateMe();
  const [values, setValues] = useState({ locale, timezone: timeZone, defaultCurrency: currency });
  const [saved, setSaved] = useState(false);
  const zones = TIME_ZONES.includes(timeZone) ? TIME_ZONES : [timeZone, ...TIME_ZONES];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    if (!isValidTimeZone(values.timezone)) return;
    await update.mutateAsync(values);
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('settings.title')} />
      <SettingsTabs />
      <Card className="max-w-xl">
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3">
          <CardTitle>{t('settings.preferences')}</CardTitle>
          {saved ? <Alert variant="success">{t('settings.saved')}</Alert> : null}
          {update.isError ? <Alert>{t('common.saveError')}</Alert> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pref-locale">{t('settings.language')}</Label>
            <Select
              id="pref-locale"
              value={values.locale}
              onChange={(e) => setValues((v) => ({ ...v, locale: e.target.value as 'en' | 'bn' }))}
            >
              <option value="en">English</option>
              <option value="bn">বাংলা</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pref-tz">{t('settings.timezone')}</Label>
            <Select
              id="pref-tz"
              value={values.timezone}
              onChange={(e) => setValues((v) => ({ ...v, timezone: e.target.value }))}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </div>
          <FormField
            label={t('settings.defaultCurrency')}
            maxLength={3}
            value={values.defaultCurrency}
            onChange={(e) =>
              setValues((v) => ({ ...v, defaultCurrency: e.target.value.toUpperCase() }))
            }
          />
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export function SecuritySettings() {
  const t = useT();
  const { locale, timeZone } = useLocale();
  const router = useRouter();
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const change = useChangePassword();
  const [done, setDone] = useState(false);
  const form = useForm<z.input<typeof changePasswordRequestSchema>>({
    resolver: zodResolver(changePasswordRequestSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const { formError, handle } = useApiFormError(form.setError);

  const onSubmit = form.handleSubmit(async (values) => {
    setDone(false);
    try {
      await change.mutateAsync(values);
      form.reset();
      setDone(true);
      void sessions.refetch();
    } catch (error) {
      handle(error);
    }
  });

  async function signOutEverywhere() {
    await authedRequest('/auth/logout-all', { method: 'POST' });
    setSession({ status: 'anonymous' });
    router.replace('/login');
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('settings.title')} />
      <SettingsTabs />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-3">
            <CardTitle>{t('settings.changePassword')}</CardTitle>
            {done ? <Alert variant="success">{t('settings.passwordChanged')}</Alert> : null}
            {formError ? <Alert>{formError}</Alert> : null}
            <FormField
              label={t('settings.currentPassword')}
              type="password"
              autoComplete="current-password"
              error={form.formState.errors.currentPassword?.message}
              {...form.register('currentPassword')}
            />
            <FormField
              label={t('settings.newPassword')}
              type="password"
              autoComplete="new-password"
              error={form.formState.errors.newPassword?.message}
              {...form.register('newPassword')}
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('settings.changePassword')}
            </Button>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck aria-hidden className="size-3.5" /> {t('settings.mfaSoon')}
            </p>
          </form>
        </Card>

        <Card className="flex flex-col gap-3">
          <CardTitle>{t('settings.sessions')}</CardTitle>
          {sessions.isPending ? (
            <LoadingBlock className="h-24" />
          ) : sessions.isError ? (
            <ErrorBlock onRetry={() => void sessions.refetch()} />
          ) : (
            <ul className="divide-y text-sm">
              {sessions.data.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate">{s.userAgent ?? 'Unknown device'}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.current
                        ? t('settings.thisDevice')
                        : t('settings.lastUsed', {
                            when: formatDateTime(s.lastUsedAt, timeZone, locale),
                          })}
                    </p>
                  </div>
                  {!s.current ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(s.id)}
                    >
                      {t('settings.signOut')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void signOutEverywhere()}
          >
            <LogOut aria-hidden /> {t('settings.signOutAll')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('settings.deletion')}</p>
        </Card>
      </div>
    </div>
  );
}
