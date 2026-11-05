import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Local development convenience: Prisma 7 no longer loads .env automatically.
// Explicit environment variables always win over the file.
const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Not needed for `prisma generate`; required for migrate/seed/studio.
    url: process.env.DATABASE_URL ?? '',
  },
});
