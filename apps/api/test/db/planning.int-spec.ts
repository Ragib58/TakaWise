import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  connectTestDb,
  createTestAccount,
  createTestUser,
  dbError,
  systemCategoryId,
  type TestAccount,
  type TestUser,
} from './fixtures';

describe('users, planning and platform tables (DB)', () => {
  let prisma: PrismaClient;
  let user: TestUser;
  let cash: TestAccount;

  beforeAll(async () => {
    prisma = connectTestDb();
    user = await createTestUser(prisma);
    cash = await createTestAccount(prisma, user.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('users', () => {
    it('rejects an email that is not normalised to lower case', async () => {
      const message = await dbError(
        prisma.user.create({
          data: { email: `Mixed.Case-${randomUUID()}@Example.com`, passwordHash: 'x' },
        }),
      );
      expect(message).toMatch(/users_email_normalized/);
    });

    it('rejects a duplicate email', async () => {
      const email = `dup-${randomUUID()}@test.takawise.local`;
      await prisma.user.create({ data: { email, passwordHash: 'x' } });
      expect(await dbError(prisma.user.create({ data: { email, passwordHash: 'x' } }))).toMatch(
        /Unique constraint/,
      );
    });

    it('defaults profile to English, Asia/Dhaka and BDT', async () => {
      const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } });
      expect(profile).toMatchObject({
        locale: 'EN',
        timezone: 'Asia/Dhaka',
        defaultCurrency: 'BDT',
      });
    });
  });

  describe('idempotency keys (ADR-006)', () => {
    it('rejects reusing a key for the same user but allows it for another user', async () => {
      const key = randomUUID();
      const row = (userId: string) => ({
        userId,
        key,
        scope: 'POST /transactions',
        requestHash: 'a'.repeat(64),
        responseStatus: 201,
        responseBody: { ok: true },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await prisma.idempotencyKey.create({ data: row(user.id) });
      expect(await dbError(prisma.idempotencyKey.create({ data: row(user.id) }))).toMatch(
        /Unique constraint/,
      );

      const other = await createTestUser(prisma);
      await expect(prisma.idempotencyKey.create({ data: row(other.id) })).resolves.toBeDefined();
    });
  });

  describe('categories', () => {
    it('requires custom categories to belong to a user and system ones to have no owner', async () => {
      expect(
        await dbError(
          prisma.category.create({ data: { type: 'EXPENSE', nameEn: 'Orphan', nameBn: 'অনাথ' } }),
        ),
      ).toMatch(/categories_system_ownership/);
    });

    it('rejects duplicate active custom names per type, case-insensitively', async () => {
      await prisma.category.create({
        data: { userId: user.id, type: 'EXPENSE', nameEn: 'Pets', nameBn: 'পোষা প্রাণী' },
      });
      expect(
        await dbError(
          prisma.category.create({
            data: { userId: user.id, type: 'EXPENSE', nameEn: 'PETS', nameBn: 'পোষা' },
          }),
        ),
      ).toMatch(/categories_user_type_active_name_key|Unique constraint/);
      // Same name with a different type is fine.
      await expect(
        prisma.category.create({
          data: { userId: user.id, type: 'INCOME', nameEn: 'Pets', nameBn: 'পোষা প্রাণী' },
        }),
      ).resolves.toBeDefined();
    });

    it('rejects a child whose parent has a different type', async () => {
      const salary = await systemCategoryId(prisma, 'income.salary');
      expect(
        await dbError(
          prisma.category.create({
            data: {
              userId: user.id,
              parentId: salary,
              type: 'EXPENSE',
              nameEn: 'Odd',
              nameBn: 'অদ্ভুত',
            },
          }),
        ),
      ).toMatch(/parent category must have the same type/);
    });
  });

  describe('budgets', () => {
    it('rejects an end date before the start date', async () => {
      expect(
        await dbError(
          prisma.budget.create({
            data: {
              userId: user.id,
              name: 'Backwards',
              startDate: new Date('2026-11-30'),
              endDate: new Date('2026-11-01'),
              currency: 'BDT',
            },
          }),
        ),
      ).toMatch(/budgets_date_range/);
    });

    it('accepts expense categories and rejects income categories in budget items', async () => {
      const budget = await prisma.budget.create({
        data: {
          userId: user.id,
          name: 'November',
          startDate: new Date('2026-11-01'),
          endDate: new Date('2026-11-30'),
          currency: 'BDT',
          overallAmount: '30000',
        },
      });
      const food = await systemCategoryId(prisma, 'expense.food');
      await expect(
        prisma.budgetItem.create({
          data: { budgetId: budget.id, categoryId: food, amount: '8000' },
        }),
      ).resolves.toBeDefined();

      const salary = await systemCategoryId(prisma, 'income.salary');
      expect(
        await dbError(
          prisma.budgetItem.create({
            data: { budgetId: budget.id, categoryId: salary, amount: '1' },
          }),
        ),
      ).toMatch(/category type INCOME does not match EXPENSE/);
    });
  });

  describe('savings goals (earmark model, ADR-009)', () => {
    let goalId: string;
    let contributionId: string;

    beforeAll(async () => {
      const goal = await prisma.savingsGoal.create({
        data: {
          userId: user.id,
          name: 'Eid shopping',
          targetAmount: '20000',
          currency: 'BDT',
          linkedAccountId: cash.id,
        },
      });
      goalId = goal.id;
      const contribution = await prisma.goalContribution.create({
        data: {
          goalId,
          userId: user.id,
          kind: 'CONTRIBUTION',
          amount: '2000',
          contributedOn: new Date('2026-11-05'),
        },
      });
      contributionId = contribution.id;
    });

    it.each(['CREDIT_CARD_TRACKING', 'LOAN'] as const)(
      'rejects linking a goal to a liability (%s) account',
      async (type) => {
        const liability = await createTestAccount(prisma, user.id, { type });
        expect(
          await dbError(
            prisma.savingsGoal.create({
              data: {
                userId: user.id,
                name: 'Bad',
                targetAmount: '1',
                currency: 'BDT',
                linkedAccountId: liability.id,
              },
            }),
          ),
        ).toMatch(/cannot be earmarked against a liability account/);
      },
    );

    it('rejects a goal currency that differs from the account', async () => {
      expect(
        await dbError(
          prisma.savingsGoal.create({
            data: {
              userId: user.id,
              name: 'USD',
              targetAmount: '1',
              currency: 'USD',
              linkedAccountId: cash.id,
            },
          }),
        ),
      ).toMatch(/goal currency must match/);
    });

    it("rejects contributing to another user's goal", async () => {
      const other = await createTestUser(prisma);
      expect(
        await dbError(
          prisma.goalContribution.create({
            data: {
              goalId,
              userId: other.id,
              kind: 'CONTRIBUTION',
              amount: '1',
              contributedOn: new Date(),
            },
          }),
        ),
      ).toMatch(/goal_contributions_goal_id_user_id_fkey|foreign key/i);
    });

    it('does not allow editing a contribution amount', async () => {
      expect(
        await dbError(
          prisma.goalContribution.update({
            where: { id: contributionId },
            data: { amount: '9999' },
          }),
        ),
      ).toMatch(/immutable/);
    });

    it('rejects a reversal with a different amount, accepts an exact one', async () => {
      expect(
        await dbError(
          prisma.goalContribution.create({
            data: {
              goalId,
              userId: user.id,
              kind: 'REVERSAL',
              amount: '1999',
              contributedOn: new Date(),
              reversesId: contributionId,
            },
          }),
        ),
      ).toMatch(/same amount as the original/);

      await prisma.$transaction([
        prisma.goalContribution.create({
          data: {
            goalId,
            userId: user.id,
            kind: 'REVERSAL',
            amount: '2000',
            contributedOn: new Date(),
            reversesId: contributionId,
          },
        }),
        prisma.goalContribution.update({
          where: { id: contributionId },
          data: { status: 'REVERSED' },
        }),
      ]);
      expect(
        await dbError(prisma.goalContribution.delete({ where: { id: contributionId } })),
      ).toMatch(/not allowed|Restrict|foreign key/i);
    });
  });

  describe('audit log', () => {
    it('is append-only', async () => {
      const log = await prisma.auditLog.create({
        data: { userId: user.id, actorId: user.id, action: 'test.event', requestId: 'req-1' },
      });
      expect(
        await dbError(
          prisma.auditLog.update({ where: { id: log.id }, data: { action: 'tampered' } }),
        ),
      ).toMatch(/immutable/);
      expect(await dbError(prisma.auditLog.delete({ where: { id: log.id } }))).toMatch(/immutable/);
    });
  });

  describe('restrictive deletes', () => {
    it('cannot delete a user that has financial history', async () => {
      expect(await dbError(prisma.user.delete({ where: { id: user.id } }))).toMatch(
        /foreign key|Restrict|constraint/i,
      );
    });
  });
});
