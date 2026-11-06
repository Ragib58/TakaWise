# Load Test — Dashboard, Transactions, Reports

> Phase 7 · 2026-11-06 · Target (NFR): p95 < 500 ms for common reads **under the agreed MVP load**.

## Setup

| Item   | Value                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data   | `apps/api/scripts/seed-load-test.ts`: one heavy user with 5 accounts, **6,000 transactions** over 12 months and 200 transfers, posted through the real ledger templates and DB triggers. The dev DB held about 6,600 journals and 13,000 lines in total |
| API    | one Node process, `NODE_ENV=production`, `THROTTLE_ENABLED=false`, pool of 10                                                                                                                                                                           |
| Infra  | developer laptop: Windows 10, 4 cores. PostgreSQL 17 and Redis run in Docker Desktop, and k6 runs in Docker on the **same** machine                                                                                                                     |
| Script | `infra/load/k6-core-reads.js`. Each iteration calls the dashboard, a random transaction page, a filtered search, a 12-month cash flow and a 12-month category report                                                                                    |

## Agreed MVP load (pilot): **PASS**

10 concurrent active users with 1–3 s of think time between screens, 90 s, about 20 requests/s:

| Endpoint                       | p95          | Threshold |
| ------------------------------ | ------------ | --------- |
| Dashboard overview             | 354 ms       | ✓ < 500   |
| Transactions (page)            | 140 ms       | ✓         |
| Transactions (filtered search) | 182 ms       | ✓         |
| Cash flow (12 months)          | 177 ms       | ✓         |
| Categories (12 months)         | 191 ms       | ✓         |
| Errors                         | 0 % of 1,831 | ✓         |

## Stress (above MVP load): **FAIL — capacity limit found**

| Profile                    | Throughput                 | Dashboard p95 | Other endpoints p95 |
| -------------------------- | -------------------------- | ------------- | ------------------- |
| 20 users, no think time    | about 40–50 req/s          | 0.93–1.4 s    | 0.46–0.66 s         |
| 50 users, 1–3 s think time | about 40 req/s (saturated) | 4.1 s         | 1.3–1.6 s           |

No requests failed (0 %). Latency rises because requests queue once the ceiling is reached.

## What was measured and changed

1. **The bottleneck is PostgreSQL CPU, not Node.** Under stress, Postgres used about 335 % CPU across 4 cores while Node used about 33 % of one core.
2. **Pool starvation fixed.** List endpoints used `prisma.$transaction([count, findMany])`, which holds a pooled connection idle-in-transaction across round trips. They now run the two queries in parallel without a transaction (transactions, transfers, reminders, notifications).
3. **Covering and search indexes added** (migration `read_performance`):
   - `journal_lines (ledger_account_id) INCLUDE (debit, credit)` for balance sums
   - `transactions (user_id, type, effective_date) INCLUDE (status, currency, category_id, amount)` for reports and budgets
   - a trigram GIN index for description search
4. **`VACUUM ANALYZE` after bulk loads.** Freshly inserted data has stale statistics. In production autovacuum handles this, but run it manually after any bulk import.

## Interpretation and next steps

- The pilot target is met with margin on a laptop that also runs the database and the load generator. A managed database with dedicated CPU (RDS) will have more headroom, but **we must re-measure on staging** before public launch.
- The dashboard is the most expensive read, at about 17 queries per request. Several aggregations are repeated: the category totals equal the budget's spend query, and account balances are computed for both accounts and goals.
- If staging also fails the stress profile, change things in this order:
  1. Merge the dashboard's duplicate aggregates.
  2. Add a rebuildable monthly projection, as allowed by ADR-004 now that measurements justify it.
  3. Use read replicas for reports.
- Scaling API instances alone will not help while the database is the bottleneck. Rate-limit counters are already shared through Redis, so adding instances is safe once it does help.

## How to re-run

```bash
pnpm infra:up
DATABASE_URL=… pnpm --filter @takawise/api exec tsx scripts/seed-load-test.ts loadtest@takawise.local 6000
# start the API with THROTTLE_ENABLED=false, then:
docker run --rm -i -e API=http://host.docker.internal:4000/api/v1 -e EMAIL=loadtest@takawise.local \
  -e PASSWORD="load test passphrase 2026" -e VUS=10 -e THINK=1 -e DURATION=90s \
  grafana/k6:0.54.0 run - < infra/load/k6-core-reads.js
```
