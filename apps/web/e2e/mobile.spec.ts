import { expect, test } from '@playwright/test';
import { registerAndVerify } from './helpers';

/** Core screens work at phone size with bottom navigation (blueprint §9.4). */
test('mobile: bottom navigation and core screens', async ({ page }) => {
  await registerAndVerify(page, 'Mobile User');

  const bottomNav = page.getByRole('navigation', { name: 'Main' }).last();
  await expect(bottomNav).toBeVisible();
  for (const [label, heading] of [
    ['Transactions', 'Transactions'],
    ['Accounts', 'Accounts'],
    ['Budgets', 'Budgets'],
    ['Dashboard', 'Dashboard'],
  ] as const) {
    await bottomNav.getByRole('link', { name: label }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }

  // Switch to Bangla in preferences; the shell follows.
  await page.goto('/app/settings/preferences');
  await page.getByLabel('Language').selectOption('bn');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'সেটিংস' })).toBeVisible();
  await expect(bottomNav.getByRole('link', { name: 'ড্যাশবোর্ড' })).toBeVisible();
});
