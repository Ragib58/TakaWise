import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrismaClient } from '../src/database/prisma-client';

/**
 * Bootstrap staff access (ADR-027). The first ADMIN can only be created here,
 * by someone with database credentials; after that, admins manage roles in the
 * app. Every change is written to the audit log.
 *
 *   pnpm --filter @takawise/api admin:role -- someone@example.com ADMIN
 *   pnpm --filter @takawise/api admin:role -- someone@example.com NONE
 */

const ROLES = ['NONE', 'SUPPORT', 'ADMIN'] as const;
type Role = (typeof ROLES)[number];

async function main(): Promise<void> {
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const [emailArg, roleArg] = process.argv.slice(2).filter((a) => a !== '--');
  const email = emailArg?.trim().toLowerCase();
  const role = roleArg?.toUpperCase() as Role | undefined;
  if (!email || !role || !ROLES.includes(role)) {
    throw new Error('Usage: admin:role -- <email> <NONE|SUPPORT|ADMIN>');
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const prisma = createPrismaClient({ connectionString, maxConnections: 1 });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No user with e-mail ${email}`);
    if (user.status !== 'ACTIVE') throw new Error('The user must have verified their e-mail first');
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { platformRole: role } }),
      prisma.auditLog.create({
        data: {
          action: 'admin.role.changed',
          userId: user.id,
          actorId: null,
          entityType: 'user',
          entityId: user.id,
          requestId: 'cli',
          metadata: { from: user.platformRole, to: role, via: 'cli' },
        },
      }),
    ]);
    console.warn(`${email}: ${user.platformRole} → ${role}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
