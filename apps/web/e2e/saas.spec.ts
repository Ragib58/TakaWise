import { expect, type Page, test } from '@playwright/test';
import { inviteCodeFor, promote, registerAndVerify } from './helpers';

/**
 * Phase 10 through the UI: staff bootstrap via the CLI, the separate admin
 * console, a complimentary Family plan, a family workspace with an e-mailed
 * invitation code, explicit sharing, immediate loss of access on removal, and
 * a support ticket answered by staff — who never see financial records.
 */

async function addAccount(page: Page, name: string, balance: string) {
  await page.goto('/app/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type', { exact: true }).selectOption('CASH');
  await page.getByLabel('Opening balance').fill(balance);
  await page.getByRole('button', { name: 'Add account' }).last().click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('family plan, sharing, removal and support', async ({ browser }) => {
  // Three users register (Argon2id + e-mail codes) and act in turn.
  test.setTimeout(300_000);
  const adminPage = await (await browser.newContext()).newPage();
  const ownerPage = await (await browser.newContext()).newPage();
  const memberPage = await (await browser.newContext()).newPage();

  const adminEmail = await registerAndVerify(adminPage, 'Admin Staff');
  const ownerEmail = await registerAndVerify(ownerPage, 'Owner Rahman');
  const memberEmail = await registerAndVerify(memberPage, 'Member Rahman');

  // Customers cannot use the console.
  await ownerPage.goto('/admin');
  await expect(ownerPage.getByText('Staff only')).toBeVisible();

  // Owner starts on Free; family needs a plan.
  await ownerPage.goto('/app/billing');
  await expect(ownerPage.getByText('Your plan: Free')).toBeVisible();
  await ownerPage.goto('/app/family');
  await expect(ownerPage.getByText(/part of the Family plan/)).toBeVisible();

  // Staff bootstrap + complimentary Family plan from the console.
  promote(adminEmail, 'ADMIN');
  await adminPage.goto('/admin/users');
  await adminPage.getByLabel('E-mail').fill(ownerEmail);
  await adminPage.getByRole('button', { name: 'Find' }).click();
  await expect(adminPage.getByText('Owner Rahman')).toBeVisible();
  await adminPage.getByLabel('Plan').selectOption('FAMILY');
  await adminPage.getByRole('button', { name: 'Grant complimentary plan' }).click();
  await expect(adminPage.getByText(/FAMILY · ACTIVE/)).toBeVisible();

  // Owner creates the workspace and invites the member.
  await addAccount(ownerPage, 'Household cash', '5000');
  await addAccount(ownerPage, 'Private savings', '90000');
  await ownerPage.goto('/app/family');
  await ownerPage.getByLabel('Workspace name').fill('Rahman family');
  await ownerPage.getByRole('button', { name: 'Create a family workspace' }).last().click();
  await expect(ownerPage.getByText('1 of 6 members')).toBeVisible();
  await ownerPage.getByLabel('Invite by e-mail').fill(memberEmail);
  await ownerPage.getByRole('button', { name: 'Send invitation' }).click();
  await expect(ownerPage.getByText(/invitation pending/)).toBeVisible();

  // Member joins with the e-mailed code; nothing is shared yet.
  await memberPage.goto('/app/family');
  await memberPage.getByLabel('Invitation code').fill(await inviteCodeFor(memberEmail));
  await memberPage.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(memberPage.getByText('You joined Rahman family.')).toBeVisible();
  await expect(memberPage.getByText('Nothing has been shared yet.')).toBeVisible();

  // Owner shares exactly one account.
  await ownerPage.reload();
  await ownerPage.getByLabel('Item').selectOption({ label: 'Household cash' });
  await ownerPage.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(ownerPage.getByRole('button', { name: 'Stop sharing' })).toBeVisible();

  await memberPage.reload();
  await expect(memberPage.getByText('Household cash')).toBeVisible();
  await expect(memberPage.getByText('৳5,000.00')).toBeVisible();
  await expect(memberPage.getByText('Private savings')).toHaveCount(0);

  // Removal ends access immediately.
  await ownerPage.reload();
  await ownerPage.getByRole('button', { name: 'Remove' }).click();
  await expect(ownerPage.getByText('1 of 6 members')).toBeVisible();
  await memberPage.reload();
  await expect(memberPage.getByText('Household cash')).toHaveCount(0);
  await expect(memberPage.getByText('Join with a code')).toBeVisible();

  // Support: the member asks, staff answers, the member sees the reply.
  await memberPage.goto('/app/support');
  await memberPage.getByLabel('Subject').fill('Left the family');
  await memberPage.getByLabel('Message').fill('Can I rejoin later?');
  await memberPage.getByRole('button', { name: 'Send' }).click();
  await expect(memberPage.getByText(/We will reply here/)).toBeVisible();

  await adminPage.goto('/admin/tickets');
  const ticket = adminPage.locator('li').filter({ hasText: 'Left the family' }).first();
  await ticket.getByLabel('Reply').fill('Yes, ask the owner for a new invitation.');
  await ticket.getByRole('button', { name: 'Reply' }).click();
  // Answered tickets move to 'Waiting for user' and leave the default OPEN filter.
  await expect(ticket).toHaveCount(0);

  await memberPage.reload();
  await expect(memberPage.getByText('Yes, ask the owner for a new invitation.')).toBeVisible();
  await expect(memberPage.getByText('Waiting for you')).toBeVisible();
});
