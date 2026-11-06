import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8035';

export const PASSWORD = 'amar sonar bangla 1971';
export const uniqueEmail = () => `e2e-${randomUUID().slice(0, 8)}@example.com`;

/** Latest 6-digit code emailed to `email` (Mailpit HTTP API). */
export async function codeFor(email: string, timeoutMs = 20_000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (res.ok) {
      const body = (await res.json()) as { messages?: { Subject: string }[] };
      const code = body.messages?.[0]?.Subject.match(/\d{6}/)?.[0];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No verification email for ${email}`);
}

/** Register through the UI, verify with the emailed code, land on the dashboard. */
export async function registerAndVerify(page: Page, name = 'Karim Ahmed'): Promise<string> {
  const email = uniqueEmail();
  await page.goto('/register');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/verify-email/);
  await page.getByLabel('Verification code').fill(await codeFor(email));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  return email;
}
