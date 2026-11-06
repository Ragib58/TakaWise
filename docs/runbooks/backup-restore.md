# Runbook — Backups, PITR & Restore Drill

> Owner: on-call engineer · Last drill: **2026-11-06, PASS** (local; repeat on staging before launch).

## Policy (production, AWS RDS PostgreSQL)

| Item                   | Setting                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Automated backups      | enabled, **retention 14 days**, daily window 21:00–22:00 UTC (03:00–04:00 Asia/Dhaka)                 |
| Point-in-time recovery | enabled (continuous WAL), restore to any second within the retention window                           |
| Encryption             | storage encrypted with KMS; snapshots inherit it                                                      |
| Pre-deploy snapshot    | `deploy.yml` takes a manual snapshot before production migrations                                     |
| Monthly logical export | `pg_dump --format=custom` to a separate, encrypted S3 bucket in another region, kept for 12 months    |
| Targets                | **RPO ≤ 5 min** (PITR), **RTO ≤ 1 h** for a full restore                                              |
| Access                 | restore permissions are limited to on-call engineers; every restore is logged in the incident channel |

Redis holds no authoritative data. It only stores job schedules, rate-limit counters and queues, so after a loss it simply needs to be recreated. Object storage is not used in the MVP.

## Restore drill (monthly, and after any major migration)

Run `infra/scripts/restore-drill.sh`. It:

1. Dumps the source.
2. Restores into a new database, `takawise_restore_drill_<ts>`.
3. Runs `infra/scripts/verify-ledger.sql` on both databases.
4. Checks that every violation count is zero and that both fingerprints (row counts, Σ debits per ledger class, migrations applied) are identical.
5. Drops the drill database.

```bash
SOURCE_URL=postgresql://…/takawise TARGET_ADMIN_URL=postgresql://…/postgres ./infra/scripts/restore-drill.sh
```

On staging, restore the latest automated **snapshot** to a temporary RDS instance as well. Point `SOURCE_URL` at staging and `TARGET_ADMIN_URL` at the temporary instance, run the same verification, and then delete the instance.

### 2026-11-06 result (dev DB)

Restore took 8 s. The checks were:

- `unbalanced_journals = 0`
- `bad_lines = 0`
- `cross_user_lines = 0`
- `transaction_journal_mismatch = 0`
- `negative_goal_progress = 0`

The fingerprints matched: 6,624 journals, 13,248 lines, 6,207 transactions, 404 transfers and 4 migrations. Result: **PASS**.

## Restoring production (incident)

1. Declare an incident ([incident-response.md](incident-response.md)). Freeze deploys.
2. Choose the restore point. For a bad migration or bad data, pick the time just before the deploy or event. The audit log and the deploy history help pinpoint it.
3. Restore with PITR to a **new** instance. Never overwrite the live one.
4. Run `verify-ledger.sql` against the new instance. All violation counts must be 0.
5. Put the API into maintenance mode (scale it to 0 or have the load balancer return 503). Point `DATABASE_URL` at the new instance (rotate the secret) and scale the API back up.
6. Run the smoke test ([../../infra/scripts/smoke.sh](../../infra/scripts/smoke.sh)). Keep the old instance for 7 days for forensics.
7. Writes made after the restore point are lost. Communicate this to affected users. Their exports and the audit log help reconstruct what happened.
