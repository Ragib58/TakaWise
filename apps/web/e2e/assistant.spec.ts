import { expect, test } from '@playwright/test';
import { registerAndVerify } from './helpers';

/**
 * Phase 9: opt-in AI through the UI with the deterministic offline provider
 * (AI_PROVIDER=fake). Consent gates each feature, a typed sentence becomes a
 * draft that is only saved when the user presses Save, the monthly summary
 * shows backend-computed figures, and "delete my AI data" turns it all off.
 */
test('assistant: consent, draft review and save, monthly summary, delete', async ({ page }) => {
  await registerAndVerify(page, 'Assistant User');

  await page.goto('/app/accounts');
  await page.getByLabel('Name', { exact: true }).fill('Wallet');
  await page.getByLabel('Type', { exact: true }).selectOption('CASH');
  await page.getByLabel('Opening balance').fill('10000');
  await page.getByRole('button', { name: 'Add account' }).last().click();
  await expect(page.getByRole('heading', { name: 'Wallet', exact: true })).toBeVisible();

  await page.goto('/app/assistant');
  await expect(page.getByRole('heading', { name: 'AI assistant' })).toBeVisible();
  test.skip(
    await page.getByText(/not switched on/).isVisible(),
    'API is running without AI_ENABLED=true AI_PROVIDER=fake',
  );
  await expect(page.getByText(/not financial, investment, tax or legal advice/)).toBeVisible();

  // Nothing works before consent.
  await expect(page.getByLabel('What happened?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Allow: Type a transaction' }).click();
  await expect(page.getByRole('button', { name: 'Turn off: Type a transaction' })).toBeVisible();

  // Draft → review in the normal form → explicit Save.
  await page.getByLabel('What happened?').fill('Paid 450 for lunch');
  await page.getByRole('button', { name: 'Draft it' }).click();
  await expect(page.getByText(/Nothing is saved until you press Save/)).toBeVisible();
  await expect(page.getByLabel('Amount')).toHaveValue('450.00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Saved\. Balance of Wallet is now .9,550\.00/)).toBeVisible();

  // Monthly summary: every number comes from the backend facts.
  await page.getByRole('button', { name: 'Allow: Monthly insights' }).click();
  await page.getByRole('button', { name: 'Explain' }).click();
  await expect(page.locator('p').filter({ hasText: 'This month you received' })).toContainText(
    '৳450.00',
  );
  await expect(page.getByText('Based only on what you recorded in TakaWise.')).toBeVisible();

  // A second ask with unchanged figures is served from the stored answer.
  await page.getByRole('button', { name: 'Explain' }).click();
  await expect(page.getByText(/Saved answer/)).toBeVisible();

  // Delete my AI data: every consent off again.
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete my AI data' }).click();
  await expect(page.getByText(/AI features turned off; 1 stored insights deleted/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow: Monthly insights' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow: Type a transaction' })).toBeVisible();
});
