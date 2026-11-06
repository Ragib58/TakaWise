# Runbook — Incident Response

## Severity

| Sev   | Examples                                                                                       | Response                                                        |
| ----- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **1** | Data exposed across users, wrong balances or ledger violations, credential leak, total outage  | Page on-call immediately; all hands; status update every 30 min |
| **2** | Partial outage (login, posting or reports failing), Redis down (jobs paused), error rate > 5 % | On-call within 15 min                                           |
| **3** | Degraded performance (p95 > 1 s), a single non-critical feature broken                         | Next business day                                               |

## First 15 minutes

1. **Acknowledge** in the incident channel. Name an incident lead, and start a timeline in UTC with Asia/Dhaka in brackets.
2. **Assess** using the following:
   - `GET /api/v1/health/ready`: database and Redis status.
   - Metrics: `takawise_http_requests_total{status_class="5xx"}` and request-duration p95 by route.
   - Logs, filtered by `requestId` (users and the web app show it in error envelopes).
   - For any money-related report, run `infra/scripts/verify-ledger.sql` against a read replica or a restore.
3. **Contain:**
   - Bad deploy: roll back the application ([migrations.md](migrations.md)).
   - Suspected breach: rotate secrets and revoke sessions ([secret-rotation.md](secret-rotation.md)). Consider maintenance mode.
   - Abuse: tighten rate limits or block at the load balancer or WAF.
   - Data damage: stop writes, then PITR ([backup-restore.md](backup-restore.md)).
4. **Communicate:**
   - Status page or in-app notice.
   - For a personal-data breach, notify affected users and follow Bangladesh legal guidance (counsel review is a launch requirement).

## Useful facts

- **Posted history is immutable.** Journals, lines and audit logs reject UPDATE and DELETE at the database level, so a corruption investigation can trust the history. Corrections are reversals.
- The **audit log** records auth events, account and transaction changes, and exports with request IDs and hashed IPs. It never contains secrets or notes.
- **Background jobs** are idempotent. After Redis recovers they resume without duplicates, because reminders are claimed with SKIP LOCKED.

## After the incident

Within 5 business days, run a blameless post-mortem. Cover the timeline, root cause, impact (users and data), what worked, and action items with owners. Add a regression test for the root cause wherever possible.
