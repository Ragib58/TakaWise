import { runSeed } from '../../src/database/seed/run-seed';
import { SYSTEM_CATEGORIES } from '../../src/database/seed/system-categories';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { connectTestDb } from './fixtures';

const expectedCategoryCount = SYSTEM_CATEGORIES.reduce(
  (n, c) => n + 1 + (c.children?.length ?? 0),
  0,
);

describe('reference-data seed (DB)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = connectTestDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('is idempotent: re-running keeps ids and counts stable', async () => {
    const before = await prisma.category.findMany({
      where: { isSystem: true },
      orderBy: { systemKey: 'asc' },
    });
    const summary = await runSeed(prisma);
    const after = await prisma.category.findMany({
      where: { isSystem: true },
      orderBy: { systemKey: 'asc' },
    });

    expect(summary).toEqual({ ledgerTemplates: 3, categories: expectedCategoryCount });
    expect(after).toHaveLength(expectedCategoryCount);
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
  });

  it('seeds the three system ledger templates with correct normal balances', async () => {
    const templates = await prisma.ledgerAccountTemplate.findMany({ orderBy: { code: 'asc' } });
    expect(templates.map((t) => [t.code, t.class, t.normalBalance])).toEqual([
      ['EQUITY_OPENING_BALANCE', 'EQUITY', 'CREDIT'],
      ['INCOME', 'INCOME', 'CREDIT'],
      ['EXPENSE', 'EXPENSE', 'DEBIT'],
    ]);
  });

  it('gives every system category an English and a Bangla name', async () => {
    const categories = await prisma.category.findMany({ where: { isSystem: true } });
    for (const c of categories) {
      expect(c.nameEn.trim()).not.toBe('');
      expect(c.nameBn).toMatch(/[ঀ-৿]/); // Bengali script block
      expect(c.userId).toBeNull();
    }
  });

  it('keeps children under a parent of the same type', async () => {
    const children = await prisma.category.findMany({
      where: { isSystem: true, parentId: { not: null } },
      include: { parent: true },
    });
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) expect(child.parent?.type).toBe(child.type);
  });

  it('covers both income and expense', async () => {
    const counts = await prisma.category.groupBy({
      by: ['type'],
      where: { isSystem: true },
      _count: true,
    });
    expect(counts.map((c) => c.type).sort()).toEqual(['EXPENSE', 'INCOME']);
  });
});
