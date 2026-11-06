# Runbook — Database Migrations, Rollback & Forward-Fix

## Rules

1. **Migrations only.** Never change production data or schema by hand. Prisma migrations live in `apps/api/prisma/migrations`, and an applied migration is never edited.
2. **CI checks drift:** `prisma migrate deploy` on an empty database, then `migrate diff --exit-code` against `schema.prisma`.
3. **Expand → migrate → contract.** Each release must work with the previous schema version, so that a rollback only has to change the application:
   - _Expand:_ add nullable columns, new tables and new indexes. Create large indexes with `CREATE INDEX CONCURRENTLY` in their own migration.
   - _Deploy_ code that writes both the old and new shapes, then backfill in batches.
   - _Contract:_ drop old columns in a **later** release, once no running code reads them.
4. **Financial invariants are part of the schema.** These are CHECKs, triggers, composite FKs and immutability guards. Any migration touching `journal_*`, `transactions`, `transfers` or `goal_contributions` needs a second reviewer, and `verify-ledger.sql` must pass on staging afterwards.
5. Hand-written SQL objects (triggers, partial or expression indexes) must also be reflected in `schema.prisma` when Prisma can see them, or CI drift fails. Example: the INCLUDE indexes are declared in `schema.prisma`, and `migration.sql` keeps `INCLUDE`.

## Production procedure (automated by `deploy.yml`)

1. A snapshot is taken (`deploy.sh snapshot`).
2. The migrator image runs `prisma migrate deploy` as a one-off task.
3. The API rolls out (rolling update; health checks must pass).
4. The smoke test runs. On failure, use the rollback below.

## Rollback vs forward-fix

| Situation                                                   | Action                                                                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New code is broken; the migration was expand-only           | **Roll back the application** to the previous image tag. Leave the schema in place, because the old code tolerates it                                                                 |
| A migration failed partway                                  | Prisma marks it failed. Fix it and re-run, or run `prisma migrate resolve --rolled-back <name>` after manually reverting the partial DDL, and write the revert as a reviewed SQL file |
| A migration succeeded but is logically wrong (no data loss) | **Forward-fix** with a new migration. Do not edit history                                                                                                                             |
| Data was damaged                                            | Stop writes, then PITR-restore to a new instance ([backup-restore.md](backup-restore.md)) and reconcile                                                                               |

Never run `prisma migrate reset` or `db push --force-reset` against shared environments. Both drop data.

## Local development

- `pnpm db:migrate` creates and applies a migration from `schema.prisma` changes.
- `pnpm --filter @takawise/api db:migrate:create --name x` creates an empty migration for raw SQL.
- `pnpm db:deploy` applies pending migrations without creating new ones.
- `pnpm db:reset` drops all **local** data and needs human confirmation.
