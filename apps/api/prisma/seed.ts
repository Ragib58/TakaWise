import { createPrismaClient } from '../src/database/prisma-client';
import { runSeed } from '../src/database/seed/run-seed';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required to seed');

  const prisma = createPrismaClient({ connectionString, maxConnections: 2 });
  try {
    const summary = await runSeed(prisma);
    console.warn(
      `Seed complete: ${summary.ledgerTemplates} ledger templates, ${summary.categories} system categories`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed', error);
  process.exit(1);
});
