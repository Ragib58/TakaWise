'use client';

import { useCallback } from 'react';
import { useSession } from '@/components/auth/auth-provider';
import type { UiLocale } from '@/lib/format';
import { type MessageKey, messages } from './messages';

export function translate(
  locale: UiLocale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const template = messages[locale][key] ?? messages.en[key];
  return vars
    ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
    : template;
}

/** Locale and preferences of the signed-in user (defaults before sign-in). */
export function useLocale(): { locale: UiLocale; timeZone: string; currency: string } {
  const session = useSession();
  if (session.status !== 'authenticated')
    return { locale: 'en', timeZone: 'Asia/Dhaka', currency: 'BDT' };
  const { locale, timezone, defaultCurrency } = session.user.profile;
  return { locale, timeZone: timezone, currency: defaultCurrency };
}

export function useT() {
  const { locale } = useLocale();
  return useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
}
