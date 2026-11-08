import type { PrismaClient } from '../../generated/prisma/client';
import { normalBalanceFor, SYSTEM_LEDGER_ACCOUNTS } from '../../domain/ledger/ledger-rules';
import { DEFAULT_FLAGS, DEFAULT_PLANS } from './saas-defaults';
import { SYSTEM_CATEGORIES } from './system-categories';

export type SeedSummary = { ledgerTemplates: number; categories: number };

/**
 * Reference data only — never users or financial records. Idempotent: safe to
 * run on every deploy. Upserts by stable keys so ids never change.
 */
export async function runSeed(prisma: PrismaClient): Promise<SeedSummary> {
  return prisma.$transaction(
    async (tx) => {
      for (const account of SYSTEM_LEDGER_ACCOUNTS) {
        const data = {
          class: account.class,
          normalBalance: normalBalanceFor(account.class),
          nameEn: account.nameEn,
          nameBn: account.nameBn,
        };
        await tx.ledgerAccountTemplate.upsert({
          where: { code: account.code },
          create: { code: account.code, ...data },
          update: data,
        });
      }

      let categories = 0;
      for (const [index, root] of SYSTEM_CATEGORIES.entries()) {
        const parent = await tx.category.upsert({
          where: { systemKey: root.key },
          create: {
            systemKey: root.key,
            isSystem: true,
            type: root.type,
            nameEn: root.nameEn,
            nameBn: root.nameBn,
            icon: root.icon,
            sortOrder: index * 10,
          },
          update: {
            type: root.type,
            nameEn: root.nameEn,
            nameBn: root.nameBn,
            icon: root.icon,
            sortOrder: index * 10,
          },
        });
        categories += 1;

        for (const [childIndex, child] of (root.children ?? []).entries()) {
          const data = {
            type: root.type,
            parentId: parent.id,
            nameEn: child.nameEn,
            nameBn: child.nameBn,
            icon: child.icon,
            sortOrder: index * 10 + childIndex + 1,
          };
          await tx.category.upsert({
            where: { systemKey: child.key },
            create: { systemKey: child.key, isSystem: true, ...data },
            update: data,
          });
          categories += 1;
        }
      }

      // Phase 10: create-only; admins own these rows afterwards.
      for (const plan of DEFAULT_PLANS) {
        await tx.plan.upsert({ where: { code: plan.code }, create: plan, update: {} });
      }
      for (const flag of DEFAULT_FLAGS) {
        await tx.featureFlag.upsert({ where: { key: flag.key }, create: flag, update: {} });
      }

      return { ledgerTemplates: SYSTEM_LEDGER_ACCOUNTS.length, categories };
    },
    // ~40 sequential upserts: allow for a busy machine (CI, parallel test runs)
    // instead of Prisma's 5 s default. Still one atomic transaction.
    { timeout: 30_000, maxWait: 10_000 },
  );
}
