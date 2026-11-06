# MVP Acceptance Checklist

> Release: MVP 1.0 (Phase 7) · Reviewed 2026-11-06 · Scope: blueprint MVP. **Excluded by design:** bank/MFS integrations, AI advice, OCR, investments/loans, subscriptions/family/admin (Phases 8–10).

Legend: ✅ met, with automated evidence · 🟡 met locally, still needs to be repeated on staging · ⛔ not met, which blocks the public launch

## Functional

| #   | Requirement                                                                                                                                   | Status | Evidence                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| F1  | Register, verify email by OTP, log in, refresh, log out (one or all devices), forgot/reset password, change password, session list and revoke | ✅     | `apps/api/test/auth/auth-flow.int-spec.ts`; `apps/web/e2e/full-flow.spec.ts`            |
| F2  | Accounts (cash, bank, MFS wallet, card as liability) with opening balance ≥ 0, archive/restore, ledger-derived balances                       | ✅     | `test/ledger/ledger-flow.int-spec.ts`; `test/db/postings.int-spec.ts`                   |
| F3  | Income/expense with category, filters, search, pagination; reversal instead of delete                                                         | ✅     | `ledger-flow.int-spec.ts`; E2E                                                          |
| F4  | Same-currency transfers, including credit-card payments                                                                                       | ✅     | `ledger-flow.int-spec.ts`; E2E                                                          |
| F5  | Every financial write is balanced double-entry; posted history is immutable                                                                   | ✅     | `test/db/journal.int-spec.ts` (DB triggers); `domain/ledger/*.spec.ts`                  |
| F6  | Idempotent financial commands (replay, mismatch 422, concurrency)                                                                             | ✅     | `modules/idempotency/idempotency.spec.ts`; `ledger-flow.int-spec.ts`                    |
| F7  | System and custom categories in EN/BN; two levels                                                                                             | ✅     | `test/planning/planning-flow.int-spec.ts`; `test/db/seed.int-spec.ts`                   |
| F8  | Monthly budgets with utilisation that reconciles with the ledger (timezone-correct)                                                           | ✅     | `planning-flow.int-spec.ts`; `domain/planning/planning-math.spec.ts`                    |
| F9  | Earmarked savings goals (cap, contributions, reversals, achieved notification)                                                                | ✅     | `planning-flow.int-spec.ts`; `test/db/planning.int-spec.ts`                             |
| F10 | One-time reminders delivered as in-app notifications by a background worker                                                                   | ✅     | `test/jobs/background-jobs.int-spec.ts`                                                 |
| F11 | Dashboard, cash-flow, category and account reports that reconcile with Σ posted lines                                                         | ✅     | `test/reports/reports-flow.int-spec.ts`; `domain/reports/reports-domain.spec.ts`        |
| F12 | CSV export (streamed, formula-injection safe, UTF-8 BOM, audited)                                                                             | ✅     | `reports-flow.int-spec.ts`                                                              |
| F13 | Responsive UI (desktop sidebar, mobile bottom nav), English/Bangla toggle, BDT and Bangla digits                                              | ✅     | `apps/web/e2e/mobile.spec.ts`; `lib/i18n/i18n.test.ts`; `lib/format.test.ts`            |
| F14 | Public pages: features, pricing, about, help, privacy, terms                                                                                  | 🟡     | The pages exist. The privacy and terms text is a **draft** that needs legal review (L1) |

## Security

| #   | Requirement                                                                                                                        | Status | Evidence                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| S1  | Default-deny auth on every route; only the allowlisted routes are public                                                           | ✅     | `test/security/route-inventory.e2e-spec.ts` (enumerates every registered route)                                             |
| S2  | Ownership on every user-owned resource (IDOR returns 404)                                                                          | ✅     | cross-user cases in the ledger, planning and reports flow specs; [security/endpoint-review.md](security/endpoint-review.md) |
| S3  | Input validation (Zod contracts; money as strings; bounded ranges and page sizes)                                                  | ✅     | contract schemas; validation cases in the flow specs                                                                        |
| S4  | Argon2id passwords, HMAC'd OTPs, rotating refresh tokens with reuse detection, HttpOnly SameSite=Strict cookie, CSRF double-submit | ✅     | `auth-flow.int-spec.ts`; `auth-crypto.spec.ts`                                                                              |
| S5  | Rate limits shared across instances (Redis), with an in-memory fallback                                                            | ✅     | `test/jobs/rate-limit-redis.int-spec.ts`                                                                                    |
| S6  | Secure headers: API (Helmet, HSTS, CSP) and web (CSP, frame-ancestors none, nosniff, Referrer-Policy, Permissions-Policy)          | ✅     | `test/security/hardening.e2e-spec.ts`; `apps/web/next.config.ts`                                                            |
| S7  | CORS allowlist; Swagger disabled in production                                                                                     | ✅     | `env.spec.ts`; `infra/scripts/smoke.sh`                                                                                     |
| S8  | Structured JSON logs with request IDs; sensitive fields and DB errors redacted                                                     | ✅     | `hardening.e2e-spec.ts` (`sanitizeForLog`, `REDACT_PATHS`)                                                                  |
| S9  | JWT key rotation without logging users out                                                                                         | ✅     | `hardening.e2e-spec.ts`; [runbooks/secret-rotation.md](runbooks/secret-rotation.md)                                         |
| S10 | Upload restrictions                                                                                                                | ✅ n/a | The MVP exposes no upload endpoint. JSON body limit is 100 kB. `files` table is reserved for Phase 9                        |
| S11 | Dependency, secret and container scans in CI                                                                                       | ✅     | CI jobs `security` and `images`; [security/dependency-audit.md](security/dependency-audit.md)                               |

## Operations

| #   | Requirement                                                                                                         | Status | Evidence                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Liveness and readiness (database and Redis) health checks                                                           | ✅     | `app.e2e-spec.ts`; container HEALTHCHECK                                                                                                                                    |
| O2  | Prometheus metrics (route templates only; token-protected)                                                          | ✅     | `hardening.e2e-spec.ts`                                                                                                                                                     |
| O3  | p95 < 500 ms for dashboard, transactions and reports under the agreed MVP load                                      | 🟡     | Pilot profile passes locally; must be re-measured on staging. Stress limits are documented in [ops/load-test.md](ops/load-test.md)                                          |
| O4  | Backup/PITR plan and a passing restore drill                                                                        | 🟡     | [runbooks/backup-restore.md](runbooks/backup-restore.md); the local drill passed; repeat it on staging RDS                                                                  |
| O5  | Migration, rollback/forward-fix, incident and secret-rotation runbooks                                              | ✅     | [runbooks/](runbooks/)                                                                                                                                                      |
| O6  | CI/CD: lint, typecheck, unit/integration, E2E, build, container scan → staging + smoke → manual production approval | 🟡     | `.github/workflows/ci.yml` and `deploy.yml`. Deploy is **scaffolded**: it needs a cloud target and `DEPLOY_ENABLED=true` ([runbooks/deployment.md](runbooks/deployment.md)) |
| O7  | Container images run as non-root, with a health check and a separate migrator                                       | ✅     | `infra/docker/*.Dockerfile`                                                                                                                                                 |

## Launch blockers (outside engineering)

| #   | Item                                                                               | Status             |
| --- | ---------------------------------------------------------------------------------- | ------------------ |
| L1  | Legal review of the privacy policy and terms (Bangladesh data-protection guidance) | ⛔                 |
| L2  | Provision staging and production (AWS), set the secrets, wire `deploy.sh`          | ⛔                 |
| L3  | Production email provider (SPF, DKIM, DMARC on the sending domain)                 | ⛔                 |
| L4  | Domain, TLS and brand assets                                                       | ⛔                 |
| L5  | Repeat O3, O4 and the smoke test on staging, then sign off                         | ⛔ (depends on L2) |

**Engineering sign-off:** every functional, security and operations item is met in code and in local verification. The public launch depends on L1–L5.
