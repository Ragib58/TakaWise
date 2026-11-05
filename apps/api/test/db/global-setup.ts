import { execFileSync } from 'node:child_process';
import { createPrismaClient } from '../../src/database/prisma-client';
import { runSeed } from '../../src/database/seed/run-seed';
import { assertSafeTestDatabase, TEST_DATABASE_URL } from '../utils/test-database';

/**
 * Brings the test database up to date before DB integration tests:
 *   1. `prisma migrate deploy` (non-destructive: only applies pending migrations)
 *   2. idempotent reference-data seed
 * Nothing is reset or truncated; each test creates its own isolated users.
 * In CI the database is a fresh service container, so migrations are also
 * verified against an empty database on every run.
 */
export default async function globalSetup(): Promise<void> {
  assertSafeTestDatabase(TEST_DATABASE_URL);

  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: `${__dirname}/../..`,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });

  const prisma = createPrismaClient({ connectionString: TEST_DATABASE_URL, maxConnections: 2 });
  try {
    await runSeed(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
