import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { PASSWORD, registerAndVerify } from './helpers';

/**
 * Blueprint §11 E2E: register → verify → login → accounts → income → expense
 * → transfer → budget → goal → report → export, and the numbers on screen
 * reconcile with what was posted.
 */
test('full MVP flow with reconciled figures', async ({ page }) => {
  const email = await registerAndVerify(page);

  // ── Log out and back in ──
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);

  // ── Accounts ──
  await page.goto('/app/accounts');
  const addAccount = async (name: string, type: string, opening: string) => {
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Type', { exact: true }).selectOption(type);
    await page.getByLabel('Opening balance').fill(opening);
    await page.getByRole('button', { name: 'Add account' }).last().click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  };
  await addAccount('Cash', 'CASH', '10000');
  await addAccount('City Bank', 'BANK', '0');

  // ── Income and expense ──
  const addTransaction = async (
    type: 'Income' | 'Expense',
    amount: string,
    account: string,
    category: string,
  ) => {
    await page.goto('/app/transactions/new');
    await page.locator('label', { hasText: type }).click();
    await page.getByLabel('Amount').fill(amount);
    const value = await page
      .locator('#trx-account option', { hasText: `${account} (` })
      .first()
      .getAttribute('value');
    await page.getByLabel('Account').selectOption(value ?? '');
    await page.getByLabel('Category').selectOption({ label: category });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  };
  await addTransaction('Income', '50000', 'City Bank', 'Salary');
  await addTransaction('Expense', '450', 'Cash', 'Food & Dining');

  // ── Transfer (not income or spending) ──
  await page.goto('/app/accounts');
  await page.getByLabel('From account').selectOption({ index: 0 });
  await page.getByLabel('To account').selectOption({ index: 1 });
  await page.getByLabel('Amount').fill('1000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  // ── Budget ──
  await page.goto('/app/budgets');
  await page.getByLabel('Overall monthly limit (optional)').fill('20000');
  await page.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByText('৳450.00 of ৳20,000.00')).toBeVisible();

  // ── Goal (earmark) ──
  await page.goto('/app/goals');
  await page.getByLabel('Name').fill('Eid shopping');
  await page.getByLabel('Target amount').fill('8000');
  await page.getByLabel('Set aside from').selectOption({ label: 'City Bank (BDT)' });
  await page.getByRole('button', { name: 'Create goal' }).click();
  await expect(page.getByRole('heading', { name: 'Eid shopping' })).toBeVisible();
  await page.getByLabel('Amount', { exact: true }).fill('5000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('৳5,000.00 saved')).toBeVisible();

  // ── Dashboard reconciles with what was posted ──
  await page.goto('/app/dashboard');
  // 10000 opening + 50000 income − 450 expense; the transfer and the goal move nothing.
  await expect(page.getByText('৳59,550.00')).toBeVisible();
  await expect(page.getByText('৳50,000.00').first()).toBeVisible();
  await expect(page.getByText('−৳450.00')).toBeVisible();

  // ── Reports ──
  await page.goto('/app/reports');
  await page.getByRole('button', { name: 'Show as table' }).click();
  const table = page.getByRole('table', { name: 'Income vs spending' });
  await expect(table.getByRole('cell', { name: '৳50,000.00' })).toBeVisible();
  await expect(table.getByRole('cell', { name: '৳450.00' })).toBeVisible();

  // ── Export ──
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^takawise-transactions-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv).toContain('"INCOME","POSTED","City Bank"');
  expect(csv).toContain('"EXPENSE","POSTED","Cash"');
  expect(csv).toContain('"TRANSFER","POSTED"');
});
