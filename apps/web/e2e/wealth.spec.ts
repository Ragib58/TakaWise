import { expect, type Page, test } from '@playwright/test';
import { registerAndVerify } from './helpers';

/**
 * Phase 8: an investment funded from a bank, a valuation, a loan received
 * into the bank with one EMI payment, and the resulting net worth — all
 * through the UI against the real API and database.
 *
 * Net worth check: start 100,000; funding the FDR and receiving the loan move
 * money without changing net worth; the FDR is revalued +1,000; the payment's
 * interest (1,200) is the only cost → 99,800.
 */

// Six-digit amounts: match lakh grouping ("৳1,20,000.00") and western ("৳120,000.00").
const LAKH_120000 = /৳1,?20,000\.00/;
const LAKH_110538 = /৳1,?10,538\.15/;

const card = (page: Page, name: string) =>
  page
    .locator('li')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .first();

function nextMonthIso(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(15);
  return d.toISOString().slice(0, 10);
}

test('wealth: investment, loan payment and net worth', async ({ page }) => {
  await registerAndVerify(page, 'Wealth User');

  // An everyday account to fund things from.
  await page.goto('/app/accounts');
  await page.getByLabel('Name', { exact: true }).fill('Bank');
  await page.getByLabel('Type', { exact: true }).selectOption('BANK');
  await page.getByLabel('Opening balance').fill('100000');
  await page.getByRole('button', { name: 'Add account' }).last().click();
  await expect(page.getByRole('heading', { name: 'Bank', exact: true })).toBeVisible();

  // ── Investment funded from the bank (a transfer, not spending) ──
  await page.goto('/app/investments');
  await expect(page.getByText(/does not give investment advice/)).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('FDR 1 year');
  await page.getByLabel('Type', { exact: true }).selectOption('FDR');
  await page.getByLabel('Amount invested').fill('40000');
  await page.getByLabel('Money came from').selectOption({ label: 'Bank (BDT)' });
  await page.getByRole('button', { name: 'Add investment' }).last().click();
  const fdr = card(page, 'FDR 1 year');
  await expect(fdr).toContainText('৳40,000.00');
  await expect(fdr).toContainText('Recorded');

  // Revalue it as an estimate.
  await fdr.getByRole('button', { name: 'Manage' }).click();
  const valueForm = fdr.locator('form').filter({ hasText: 'Update value' });
  await valueForm.getByLabel('Value', { exact: true }).fill('41000');
  await valueForm.getByLabel('Type of value').selectOption('ESTIMATED');
  await valueForm.getByRole('button', { name: 'Save' }).click();
  await expect(fdr.getByText('৳41,000.00').first()).toBeVisible();
  await expect(fdr.getByText(/Estimate/).first()).toBeVisible();

  // ── Loan received into the bank, then one EMI payment ──
  await page.goto('/app/loans');
  await page.getByLabel('Type', { exact: true }).selectOption('BORROWED');
  await page.getByLabel('Name', { exact: true }).fill('Car loan');
  await page.getByLabel('Loan amount').fill('120000');
  await page.getByLabel('Money went to / came from').selectOption({ label: 'Bank (BDT)' });
  await page.getByLabel('Interest % per year (optional)').fill('12');
  await page.getByLabel('Term in months (optional)').fill('12');
  await page.getByLabel('First instalment date').fill(nextMonthIso());
  await page.getByRole('button', { name: 'Add loan' }).last().click();
  const loan = card(page, 'Car loan');
  await expect(loan).toContainText(LAKH_120000);
  await expect(loan).toContainText('৳10,661.85'); // EMI for 1.2 lakh at 12% over 12 months

  // The form is pre-filled with the suggested split (principal 9,461.85 + interest 1,200).
  await expect(loan.getByLabel('Principal')).toHaveValue('9461.85');
  await expect(loan.getByLabel('Interest', { exact: true })).toHaveValue('1200.00');
  await loan.getByRole('button', { name: 'Save' }).click();
  await expect(loan.getByText('Saved.')).toBeVisible();
  await expect(loan).toContainText(LAKH_110538);
  await expect(loan).toContainText('Undo');

  // ── Net worth: assets − liabilities, each thing counted once ──
  await page.goto('/app/net-worth');
  await expect(page.getByRole('heading', { level: 1, name: 'Net worth' })).toBeVisible();
  await expect(page.getByText('৳99,800.00').first()).toBeVisible();
  await expect(page.getByText('Car loan')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Net worth over time' })).toBeAttached();
});
