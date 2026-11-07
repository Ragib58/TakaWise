# TakaWise — Implementation Plan

> Phase 0 output · 2026-11-05 · Source of truth: _TakaWise SRS, Architecture & Claude Prompts v1.0_
> Companion: [architecture/decisions.md](architecture/decisions.md) (ADRs + diagrams)

---

## 1. Repository audit (current state)

| Item                        | Finding                                           | Impact                                                                                                                   |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Repository contents         | **Empty.** No source, config, docs or lockfile.   | Greenfield — no conventions to preserve. Blueprint conventions apply.                                                    |
| Git                         | **Not initialised.** Git 2.23.0 installed (2019). | `git init` required before Phase 1 (blueprint: commit before each phase). Upgrading Git is recommended but not blocking. |
| Node.js                     | v24.11.1 (Active LTS)                             | OK. Pin via `.nvmrc` / `engines`.                                                                                        |
| npm                         | 11.6.2                                            | OK (only used to bootstrap).                                                                                             |
| pnpm                        | **6.11.0** (2021)                                 | **Too old** for current workspace/lockfile features. Upgrade via Corepack (bundled 0.34.2) before Phase 1.               |
| Docker                      | CLI 20.10.17, Compose v2.6.1 + v1.29.2            | Installed, but **daemon not reachable** (`docker info` panics). Must be started/fixed before Phase 1 verification.       |
| PostgreSQL / Redis (native) | Not installed (`psql` missing)                    | Fine — Docker Compose will provide them.                                                                                 |
| OS                          | Windows 10 Pro **1909** (build 18363)             | Old build; current Docker Desktop releases require newer Windows 10/11. See Risk R1.                                     |

### Gaps vs. blueprint

Everything in the blueprint is a gap: monorepo, both apps, shared packages, Docker, CI, schema, all modules, UI, tests and docs. Nothing to migrate or refactor.

---

## 2. Environment prerequisites (do before Phase 1)

PowerShell:

```powershell
# 1. Activate a modern pnpm through Corepack (bundled with Node 24)
corepack enable
corepack prepare pnpm@latest-10 --activate
pnpm -v            # expect 10.x

# 2. Start Docker Desktop, then confirm the daemon answers
docker info
docker compose version

# 3. Initialise git and make the first commit (docs only)
git init
git add docs
git commit -m "docs: phase 0 implementation plan and ADRs"
```

If Docker cannot run on build 1909, use fallback **F1** (native PostgreSQL 16+ for Windows, plus Memurai or WSL2 for Redis) and keep `docker-compose.yml` for CI and other machines.

---

## 3. Target repository structure

```
takawise/
├─ apps/
│  ├─ web/                         # Next.js App Router (TS, Tailwind, shadcn/ui)
│  │  ├─ src/app/
│  │  │  ├─ (marketing)/           # /, /features, /pricing, /about, /help, /privacy, /terms
│  │  │  ├─ (auth)/                # /login, /register, /verify-email, /forgot-password, /reset-password
│  │  │  └─ app/                   # /app/* authenticated shell (sidebar / bottom nav)
│  │  │     ├─ dashboard/ transactions/ accounts/ budgets/ goals/
│  │  │     ├─ reports/ reminders/ notifications/
│  │  │     └─ settings/{profile,security,preferences}/
│  │  ├─ src/components/ui/        # shadcn primitives
│  │  ├─ src/features/<domain>/    # domain components, hooks, queries
│  │  ├─ src/lib/                  # api-client, auth, format (money/date/digits), query-client
│  │  ├─ src/i18n/                 # next-intl config + messages/{en,bn}.json
│  │  └─ e2e/                      # Playwright specs
│  ├─ api/                         # NestJS modular monolith
│  │  ├─ prisma/                   # schema.prisma, migrations/, seed.ts
│  │  ├─ src/
│  │  │  ├─ main.ts  app.module.ts
│  │  │  ├─ config/                # Zod-validated env, fail-fast at boot
│  │  │  ├─ common/                # filters, interceptors, guards, decorators, request-id, logging
│  │  │  ├─ domain/money/          # Decimal helpers (decimal.js), normal-balance rules
│  │  │  ├─ prisma/                # PrismaService, tx helper
│  │  │  ├─ modules/
│  │  │  │  ├─ auth/ users/ accounts/ ledger/ transactions/ categories/
│  │  │  │  ├─ budgets/ goals/ reports/ dashboard/ reminders/ notifications/
│  │  │  │  ├─ exports/ files/ audit/ idempotency/ health/
│  │  │  └─ jobs/                  # BullMQ queues + processors (email, reminders, outbox)
│  │  └─ test/                     # integration + API e2e (real Postgres)
│  └─ worker/                      # (later) separate entrypoint reusing api modules
├─ packages/
│  ├─ contracts/                   # Zod schemas + inferred types shared by web & api
│  ├─ tsconfig/                    # base, nextjs, nestjs, library presets
│  └─ eslint-config/               # flat config presets
├─ infra/docker/                   # Dockerfiles (api, web)
├─ infra/aws/                      # (Phase 7) IaC placeholders
├─ docs/
│  ├─ implementation-plan.md       # this file
│  ├─ architecture/decisions.md    # ADRs
│  ├─ architecture/erd.md          # (Phase 2) generated/maintained ERD
│  ├─ api/                         # (Phase 3+) API notes; Swagger is canonical
│  └─ runbooks/                    # (Phase 7) incident, restore, secret rotation
├─ .github/workflows/ci.yml
├─ docker-compose.yml              # postgres, redis, mailpit (dev email)
├─ .env.example  .nvmrc  .editorconfig  .gitignore
├─ pnpm-workspace.yaml  package.json
└─ README.md
```

`apps/worker` starts **inside the API process** (a BullMQ module) in the MVP and is split out only when load justifies it (blueprint 6.2).

---

## 4. Dependencies (proposed)

Exact versions are pinned in the lockfile during Phase 1. Use the current stable majors at that time and do not adopt pre-releases.

| Area             | Choice                                                                                                           | Notes                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Package manager  | pnpm 10 workspaces                                                                                               | No Turborepo initially (`pnpm -r` is enough). Add Turbo only if CI time hurts. |
| Language         | TypeScript (strict)                                                                                              | `noUncheckedIndexedAccess` on.                                                 |
| Web              | Next.js (App Router), React                                                                                      |                                                                                |
| UI               | Tailwind CSS, shadcn/ui, lucide-react                                                                            | Fonts: Inter + Noto Sans Bengali.                                              |
| Web data         | TanStack Query, React Hook Form, Zod                                                                             |                                                                                |
| Charts           | Recharts                                                                                                         | Every chart has a table/text alternative.                                      |
| i18n             | next-intl                                                                                                        | `en` and `bn`; BDT default; `Intl.NumberFormat('bn-BD')` for Bangla digits.    |
| API              | NestJS (Express adapter)                                                                                         | Global prefix `/api/v1`.                                                       |
| Validation       | Zod (shared from `packages/contracts`) + `nestjs-zod` pipe                                                       | One schema serves web forms and API DTOs. Swagger is generated from it.        |
| ORM              | Prisma + PostgreSQL 16+                                                                                          | Raw-SQL migration pieces for CHECK constraints and triggers.                   |
| Money            | Prisma `Decimal` / `decimal.js`                                                                                  | Money crosses the API as **strings**. JS `number` is never used for money.     |
| Auth             | `@node-rs/argon2` (Argon2id, prebuilt — no node-gyp on Windows), `@nestjs/jwt`                                   |                                                                                |
| Rate limit       | `@nestjs/throttler` + Redis storage                                                                              |                                                                                |
| Queue            | BullMQ + ioredis                                                                                                 |                                                                                |
| Logging          | `nestjs-pino`                                                                                                    | Redaction paths configured centrally.                                          |
| Security headers | `helmet`                                                                                                         | CSP on web via Next headers.                                                   |
| Email            | Provider adapter. Dev: **Mailpit** (SMTP catcher in Compose). Prod: TBD (SES/Resend).                            |                                                                                |
| Files            | S3-compatible SDK (`@aws-sdk/client-s3`, presigner). Dev: MinIO (optional, v1.1).                                |                                                                                |
| Tests            | API: Jest + Supertest against a real Postgres test DB. Web/contracts: Vitest + Testing Library. E2E: Playwright. |                                                                                |
| CI               | GitHub Actions                                                                                                   | lint → typecheck → unit → integration (service containers) → build.            |

---

## 5. Domain design summary (detail in ADRs)

### 5.1 Ledger model

- Each **financial account** has exactly one **ledger account**:
  - `CASH | BANK | MOBILE_WALLET | SAVINGS | OTHER` → class `ASSET`, normal balance `DEBIT`.
  - `CREDIT_CARD_TRACKING` → class `LIABILITY`, normal balance `CREDIT`.
- Each user gets three **system ledger accounts**, created at registration from seeded templates: `EQUITY_OPENING_BALANCE` (CREDIT), `INCOME` (CREDIT) and `EXPENSE` (DEBIT). Category is a dimension on the transaction, not a separate ledger account (ADR-007).
- **Balance**: debit-normal = Σdebit − Σcredit; credit-normal = Σcredit − Σdebit. Computed from posted lines, with no stored balance column in the MVP.

### 5.2 Posting templates

| Event                                     | Debit                                    | Credit           |
| ----------------------------------------- | ---------------------------------------- | ---------------- |
| Opening balance, asset account (X > 0)    | Asset X                                  | Equity:Opening X |
| Opening balance, credit card (owed X > 0) | Equity:Opening X                         | Liability:Card X |
| Income into account A                     | A                                        | Income           |
| Expense from account A                    | Expense                                  | A                |
| Transfer A → B (same currency)            | B                                        | A                |
| Credit card bill payment (Bank → Card)    | Liability:Card                           | Asset:Bank       |
| Reversal of journal J                     | each line of J with debit/credit swapped |                  |

All lines in a journal share one currency. Σdebit = Σcredit is checked in the service **and** by a deferred constraint trigger (ADR-005).

### 5.3 Savings goals: earmark model (ADR-009)

A goal is linked to one asset account. A contribution **earmarks** part of that account's balance, and no money moves in the ledger. Progress is the sum of non-reversed contributions. A contribution is rejected if the account's total earmarks would exceed its ledger balance. The UI states: _"Goal savings are set aside from your account balance. No money is moved."_

---

## 6. Phase plan

Each phase ends with a report listing files changed, commands run, test results, known gaps and the next prerequisites. Commit before starting each phase.

### Phase 1 — Monorepo foundation (Sprint 1)

**Build:** pnpm workspace; `packages/{tsconfig,eslint-config,contracts}`; `apps/web` (Next.js App Router, Tailwind, shadcn init, a placeholder landing page and `/app` shell); `apps/api` (NestJS with `/api/v1` prefix, Zod validation pipe, global exception filter producing the standard error envelope, response envelope interceptor, request-ID middleware (`X-Request-Id`), pino logging with redaction, CORS from `CORS_ORIGINS`, helmet, Swagger at `/api/docs` when `NODE_ENV !== 'production'`, and a `/api/v1/health` liveness/readiness endpoint); Zod env validation; `docker-compose.yml` (postgres, redis, mailpit with health checks and named volumes); root scripts `dev build lint typecheck test format`; `.env.example`; README covering PowerShell and bash; CI workflow.
**Exit:** clean `pnpm install`; every root script passes; `docker compose up -d` is healthy; web on :3100 and API on :4000 respond (host ports chosen to avoid clashes: Postgres 5442, Redis 6389, Mailpit 1035/8035); CI is green.

### Phase 2 — Prisma schema and domain foundation (Sprint 2)

**Build:** the full schema (§7), initial migration plus a raw-SQL migration for CHECK constraints and the deferred balanced-journal trigger, seed (bilingual system categories and ledger-account templates), Decimal helpers, and `docs/architecture/erd.md`.
**Tests:** migration on a clean database; constraint tests (line with both debit and credit is rejected, zero amount is rejected, unbalanced journal fails at commit, duplicate email differing only in case is rejected, duplicate idempotency key is rejected).
**Exit:** `pnpm db:reset` reproduces the database from scratch.

### Phase 3 — Authentication and authorization (Sprint 3)

**Build:** register, verify email (6-digit OTP, HMAC-hashed, 10-minute expiry, 5 attempts, 60-second resend cooldown), login, refresh with rotation and reuse detection, logout, forgot/reset password (revokes all sessions), session list and revoke, `GET/PATCH /users/me`; `JwtAuthGuard` plus a `@CurrentUser()` decorator; ownership helper (`findOwnedOrThrow`) returning **404** for other users' resources; audit events; throttling on auth endpoints; CSRF protection for cookie endpoints (ADR-011); dev email via Mailpit, with console OTP allowed only when `NODE_ENV=development` (boot fails otherwise); web auth pages and the client auth provider.
**Tests:** full lifecycle integration, OTP expiry/single-use/attempt limits, refresh reuse revokes the token family, cross-user denial, rate-limit responses.

### Phase 4 — Ledger, accounts and transactions (Sprint 4–5)

**Build:** `LedgerService.post()` as the only writer of journals (validates ownership, a single currency, Σdr = Σcr and positive amounts inside one interactive Prisma transaction); accounts CRUD and archive with an opening-balance journal; income/expense create, list and detail with filters (date, account, category, type) and pagination; transfers; reversal; the idempotency layer (ADR-006); audit and outbox rows in the same transaction; balance queries.
**Tests (blueprint-mandated):** salary increases the account; expense decreases it; transfer moves both balances but leaves income/expense totals unchanged; an imbalance rolls everything back; a duplicate idempotency key creates nothing new and returns the same response; the same key with a different payload returns 422; reversal restores the balance and keeps history; a reversal cannot be reversed again; a transfer to the same account or across currencies is rejected; an archived account rejects new postings; user A cannot read or modify user B's data; credit-card expense increases the amount owed and payment decreases it.

### Phase 5 — Categories, budgets, goals, reminders (Sprint 6)

**Build:** system and custom categories (en/bn names, type INCOME/EXPENSE, archive instead of delete); monthly budgets (an overall budget and/or category items) with utilization from posted expenses in the user-timezone date range, excluding transfers and reversed pairs; earmark goals with contributions and contribution reversals; one-time reminders (`dueAt` stored in UTC, entered and displayed in the user's timezone) delivered by a BullMQ delayed job as an in-app notification (plus email if enabled); UI for each module.
**Tests:** budget period boundaries (first/last day in Asia/Dhaka versus UTC), budget math with a reversed expense, category type mismatch rejected, earmark cap enforced, goal progress equal to contribution history.

### Phase 6 — Dashboard, reports, responsive UI (Sprint 7)

**Build:** `/dashboard/overview`, `/reports/cash-flow`, `/reports/categories`, account summary, and `/exports/transactions` CSV (streamed, formula-injection escaping, BOM for Excel and Bangla); the full responsive UI (sidebar on desktop, bottom nav on mobile, cards on mobile, filter sheets), skeleton, empty and error states, Bangla/English toggle, locale-aware money, dates and digits.
**Tests:** report-to-ledger reconciliation (dashboard totals equal Σ posted lines for seeded data), CSV escaping, Playwright full flow (register → verify → login → accounts → income → expense → transfer → budget → goal → report → export) on desktop and mobile viewports.

### Phase 7 — Security, QA, MVP deployment (Sprint 8)

Endpoint-by-endpoint auth, ownership and validation review; dependency and secret scanning (e.g. `pnpm audit`, gitleaks); container scan; metrics; load test with synthetic data (p95 < 500 ms for dashboard, transaction list and reports); backup/PITR plan and restore drill; runbooks; staging deploy with smoke test and manual production approval; MVP acceptance checklist signed off.

### Phase 8 — Investments, loans, assets and net worth (post-MVP)

**Build:** `INVESTMENT` / `LOAN` / `LOAN_RECEIVABLE` accounts with detail tables (ADR-022); funding, withdrawal, disbursement and principal as transfers; returns and interest as income/expense; atomic loan payments with reversal; estimated EMI schedules from user terms; valuations labelled user-entered/estimated (verified reserved) and net-worth items (ADR-023); net worth and month-end history computed on read. Web: Investments, Loans and Net worth pages (EN/BN).
**Tests:** EMI/schedule/next-due and net-worth roll-forward unit tests; API+DB flows proving transfers never change net worth or income/expense, interest-only spending, payment atomicity/idempotency/reversal, valuation rules, IDOR and DB backstops; Playwright wealth flow.

### Phase 9 — Opt-in AI and OCR (post-MVP)

**Build** (ADR-024):

- **Gating.** AI is off by default. It needs the operator switch (`AI_ENABLED`, `AI_PROVIDER`) plus per-feature flags in `AI_FEATURES`. Users grant consent per scope against a versioned notice.
- **Insights.** Domain fact builders feed three insight kinds: monthly summary, unusual spending (deterministic outlier rule) and saving ideas.
  - The model writes `{{fact}}`-reference prose and may not write any digit. The output is validated before it is stored or shown.
  - Answers are cached by a hash of the facts.
- **Drafts.** Natural-language transaction drafts and receipt OCR use redacted input and alias-only references. Receipt images are sniffed by magic bytes and kept in memory only. Every draft is reviewed in the normal transaction form.
- **Provider.** `AnthropicProvider` uses structured outputs with no tools. `FakeProvider` is used for dev, CI and E2E.
- **Limits and controls.** Per-user and global limits, delete-my-AI-data, and audit.
- **Web.** The `/app/assistant` page (EN/BN) has consent and data-scope controls. Every answer shows its period, data scope, limitations and a disclaimer.

**Tests:**

- Unit: redaction and injection heuristics, facts and outliers, narrative rules, draft mapping, provider request and error mapping, config.
- API + DB: flags, consent, minimisation, cache, invalid output, outage, limits, revoke and delete, receipt type and size checks.
- Web component test.
- Playwright assistant flow.

### Phase 10 (post-MVP)

Subscriptions, family and admin. Follows the blueprint prompt.

---

## 7. Schema outline for Phase 2

Additions to blueprint §7.1 are marked **(+)**.

| Table                            | Key columns / constraints                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| users                            | id uuid, email (stored lowercase, unique), passwordHash, status enum, emailVerifiedAt                                                                                                            |
| user_profiles                    | userId PK/FK, fullName, locale enum(en,bn), timezone (default `Asia/Dhaka`), defaultCurrency char(3) (default `BDT`)                                                                             |
| **sessions (+)**                 | id, userId, refreshTokenHash (unique), familyId, userAgent, ipHash, expiresAt, revokedAt, replacedById                                                                                           |
| **verification_tokens (+)**      | id, userId, purpose enum(EMAIL_VERIFY, PASSWORD_RESET), codeHash, attempts, expiresAt, consumedAt                                                                                                |
| financial_accounts               | id, userId, name, type enum, currency, openingDate date, openingBalance numeric(20,4) ≥ 0, status enum(ACTIVE, ARCHIVED)                                                                         |
| ledger_accounts                  | id, userId, financialAccountId? (unique), systemCode? enum, class enum, normalBalance enum; unique(userId, systemCode)                                                                           |
| **ledger_account_templates (+)** | seeded system codes → class / normal balance                                                                                                                                                     |
| journal_entries                  | id, userId, kind enum(OPENING, INCOME, EXPENSE, TRANSFER, REVERSAL), effectiveDate date, status enum(POSTED), reversesId? (unique), currency, memo, createdAt                                    |
| journal_lines                    | id, journalEntryId, ledgerAccountId, debit numeric, credit numeric, currency. CHECK: exactly one of debit/credit > 0, the other = 0                                                              |
| transactions                     | id, userId, journalEntryId (unique), type enum(INCOME, EXPENSE), amount, currency, accountId, categoryId, occurredAt timestamptz, effectiveDate date, description, status enum(POSTED, REVERSED) |
| transfers                        | id, userId, journalEntryId (unique), sourceAccountId, destinationAccountId, amount, currency, effectiveDate, status. CHECK source ≠ destination                                                  |
| **idempotency_keys (+)**         | userId, key, scope, requestHash, responseStatus, responseBody jsonb, createdAt, expiresAt; PK(userId, key)                                                                                       |
| categories                       | id, userId? (null = system), parentId?, type enum, nameEn, nameBn, icon, isSystem, archivedAt                                                                                                    |
| budgets                          | id, userId, name, period enum(MONTHLY), startDate, endDate, currency, overallAmount?                                                                                                             |
| budget_items                     | id, budgetId, categoryId, amount; unique(budgetId, categoryId)                                                                                                                                   |
| savings_goals                    | id, userId, name, targetAmount, targetDate?, linkedAccountId, currency, status enum                                                                                                              |
| goal_contributions               | id, goalId, amount, contributedAt date, reversesId?, status                                                                                                                                      |
| reminders                        | id, userId, title, notes?, dueAt timestamptz, recurrenceRule? (null in MVP), status enum(PENDING, DONE, CANCELLED)                                                                               |
| **notifications (+)**            | id, userId, kind, payload jsonb, readAt                                                                                                                                                          |
| **outbox_events (+)**            | id, type, payload jsonb, createdAt, processedAt                                                                                                                                                  |
| files                            | id, userId, objectKey, mimeType, sizeBytes, purpose, status                                                                                                                                      |
| audit_logs                       | id, userId, actorId, action, entityType, entityId, requestId, ipHash, metadata jsonb (redacted), createdAt                                                                                       |

Indexes: `transactions(userId, effectiveDate)`, `transactions(userId, type, effectiveDate)`, `transactions(userId, accountId, effectiveDate)`, `journal_lines(ledgerAccountId)`, `journal_entries(userId, effectiveDate)`, `financial_accounts(userId, status)`, `reminders(userId, status, dueAt)`.
Deletes: `ON DELETE RESTRICT` for anything referencing journals; user-account deletion is a dedicated workflow, not a cascade.

---

## 8. Cross-cutting conventions

- **API envelope:** `{ data, meta: { requestId } }`; paginated responses add `page, pageSize, total, totalPages`; errors use `{ error: { code, message, details[], requestId } }`. `pageSize` is capped at 100.
- **Dates:** timestamps are ISO-8601 UTC in storage. Financial `effectiveDate` is `YYYY-MM-DD`, derived from `occurredAt` in the user's timezone. Report ranges are capped at 24 months.
- **Money in JSON:** a string matching `^\d{1,16}(\.\d{1,4})?$` with value > 0. The client never sums money for display totals; the server returns them.
- **Ownership:** every query on a user-owned table includes `userId` from `@CurrentUser()`. A resource owned by someone else returns 404 to avoid disclosing that it exists.
- **Not-found vs forbidden vs validation:** 404 `NOT_FOUND`, 409 `CONFLICT` (e.g. already reversed), 422 `IDEMPOTENCY_MISMATCH`, 400 `VALIDATION_ERROR`, 429 `RATE_LIMITED`.
- **Logs:** never log request bodies on auth, transaction or file routes. Redact `password, token, otp, code, authorization, cookie, description, notes`.

---

## 9. Risks

| #   | Risk                                                                           | Mitigation                                                                                                                     |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Windows 10 1909 may not run current Docker Desktop; the daemon currently fails | Upgrade Windows/Docker, **or** fallback F1 (native Postgres + Memurai/WSL Redis). CI uses Linux service containers regardless. |
| R2  | pnpm 6 is incompatible with modern lockfiles and workspace features            | Corepack → pnpm 10 (§2). Pin `packageManager` in the root package.json.                                                        |
| R3  | Floating-point money bugs from JSON numbers or JS arithmetic                   | Strings on the wire, Decimal in services, lint rule banning `Number(`/`parseFloat` in money modules, property-style tests.     |
| R4  | Balance drift or unbalanced journals from concurrent or partial writes         | Single `LedgerService.post` writer, interactive transaction, deferred trigger, no stored balances in the MVP.                  |
| R5  | Timezone off-by-one in budgets and reports (UTC vs Asia/Dhaka)                 | `effectiveDate` stored as a date computed server-side with the user's timezone; boundary tests.                                |
| R6  | IDOR through forgotten `userId` filters                                        | Ownership helper, a code-review checklist, and a cross-user test suite that runs against every route.                          |
| R7  | Native module build failures on Windows (argon2, bcrypt)                       | `@node-rs/argon2` prebuilt binaries.                                                                                           |
| R8  | Earmark goals confuse users ("where did the money go?")                        | Explicit UI copy, available-vs-earmarked display on account cards.                                                             |
| R9  | Credit-card sign confusion in totals                                           | Liability shown as "owed"; dashboard "net balance" = assets − liabilities, labelled clearly; tests.                            |
| R10 | Scope creep into post-MVP modules                                              | Feature flags; acceptance checklist gates Phase 7.                                                                             |

---

## 10. Open questions

**Blocking before Phase 1 (environment, user action):**

1. Can Docker Desktop run on this machine, or should the plan use fallback F1?
2. May I run `git init` and make the first commit, and should the repo be pushed to GitHub (needed for CI)?

**Resolved 2026-11-05 (owner accepted all defaults):** 3. Goal model = **earmark** (ADR-009). 4. Credit card = **liability ledger account in the MVP** (ADR-008). 5. Reversal effective date = **original transaction's date** (ADR-010). 6. Opening balance for asset accounts must be **≥ 0** (no overdraft opening in the MVP). 7. Docker is running locally; git initialised; GitHub push happens after Phase 1 passes.

**Non-blocking (defaults used):** production email provider (Mailpit in dev, adapter in prod); hosting (Vercel + AWS per blueprint §12, decided in Phase 7); brand/domain (launch checklist).

---

## 11. Next steps

Run the next phase prompt (see the progress log below). Before each phase: commit, re-read this plan and the ADRs, and make sure `pnpm check` is green.

## 12. Progress log

| Phase | Status | Date       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Done   | 2026-11-05 | Plan + ADR-001..017; defaults accepted by owner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 1     | Done   | 2026-11-05 | Monorepo, web/api/contracts, Docker Compose, CI; `pnpm check` green (50 tests). Toolchain in ADR-018. Host ports moved to avoid local clashes (web 3100, Postgres 5442, Redis 6389, Mailpit 1035/8035).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2     | Done   | 2026-11-05 | Prisma 7.10.1 schema (22 tables), init migration + hand-written `ledger_constraints` migration (CHECKs, deferred balance trigger, immutability, ownership/consistency triggers, partial unique indexes), composite ownership FKs, bilingual seed (34 categories + 3 ledger templates), Money/ledger domain helpers, `/health/ready`. `pnpm check` green (167 tests incl. 61 DB integration). ADR-019, [erd.md](architecture/erd.md).                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3     | Done   | 2026-11-05 | Auth: register → email OTP verify (auto sign-in) → login/refresh rotation with reuse detection → logout/logout-all, forgot/reset, session list/revoke, `/users/me` GET/PATCH + change password. Argon2id, HMAC'd OTPs, HttpOnly SameSite=Strict refresh cookie + double-submit CSRF, global default-deny guard with live session check, throttling, audit events, SMTP (Mailpit) email in EN/BN. Web: register/verify/login/forgot/reset pages, in-memory session with silent single-flight refresh, `/app` guard + logout. `pnpm check` green (230 tests incl. 22 auth API+DB flow tests); live smoke-tested against Mailpit. [docs/api/auth.md](api/auth.md).                                                                                                                                                                                     |
| 4     | Done   | 2026-11-05 | `LedgerService` as sole journal writer (pure posting templates, pre-validation + DB deferred check), accounts CRUD/archive/restore with OPENING_BALANCE journal and ledger-derived balances (cards as liabilities), income/expense create/list/detail with filters + pagination, same-currency transfers (card payments included), reversal by compensating journal (same effective date), `Idempotency-Key` on every financial command (same-transaction storage, replay header, 422 mismatch, concurrency-safe), outbox + audit rows, money lint rule (ADR-003). 30 new API+DB ledger flow tests incl. all blueprint Phase 4 cases and IDOR. [docs/api/ledger.md](api/ledger.md). API only — UI in Phase 6.                                                                                                                                       |
| 5     | Done   | 2026-11-05 | Categories API (system + custom, EN/BN, 2-level tree, archive), monthly budgets with ledger-reconciled utilization (posted expenses only, transfers/reversals excluded, parent categories include children, tz-correct month boundaries), earmark savings goals (row-locked cap, append-only history with reversals, auto ACHIEVED + notification, under-funded flag), one-time reminders with UTC instants + local dates, in-app notifications, BullMQ maintenance worker (reminder dispatch with SKIP LOCKED, idempotency cleanup) + Redis readiness. Web: budgets, goals, reminders, notifications screens (TanStack Query, accessible progress, BDT/Bangla formatting). Fixed idempotency scope length bug (route templates). `pnpm check` green (333 tests); live-tested reminder delivery via Redis. [docs/api/planning.md](api/planning.md). |
| 6     | Done   | 2026-11-06 | API: `/dashboard/overview`, `/reports/cash-flow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | categories | accounts` (bounded ranges, per-currency, ledger-reconciled), streamed CSV export (formula-safe, BOM, audited). Web: dashboard, accounts (+transfer), transactions (filters, pagination, reverse), new transaction (RHF+Zod, idempotency key per attempt), reports (Recharts + accessible tables, CSV download), settings (profile, preferences incl. Bangla, security: password, sessions, sign-out-all), public pages (features, pricing, about, help, draft privacy/terms), typed EN/BN dictionary (ADR-020). Tests: 362 unit/integration + Playwright E2E full flow and mobile (local + CI job). [docs/api/reports.md](api/reports.md). |
| 7     | Done   | 2026-11-06 | Route-inventory auth test (every route default-deny), endpoint/ownership review, Redis-backed rate limits with fallback, Prometheus metrics, log/DB-error redaction, JWT key rotation, web CSP + secure headers, graceful shutdown order, read-performance indexes, Docker images (API, migrator, web), CI security/image scans (pnpm audit, gitleaks, Trivy), gated staging→production deploy workflow + smoke test, restore drill (PASS), k6 load test (pilot profile PASS; stress limits documented), runbooks, MVP acceptance checklist. ADR-021. Deployment is scaffolded; cloud target not provisioned.                                                                                                                                                                                                                                       |
| 8     | Done   | 2026-11-07 | Investments (DPS/FDR/sanchayapatra/bond/stock/fund/gold) and loans (borrowed/lent) as ledger accounts with detail tables; funding/withdrawal/disbursement/principal as transfers, returns/interest as income/expense; atomic, idempotent loan payments (principal transfer + interest transaction) with joint reversal and generic-reverse guard; estimated EMI schedule, next due date and suggested split; valuations (user-entered/estimated, verified rejected by DB) and net-worth items; net worth + 2–24 month history computed on read with valuation roll-forward (no double counting); 3 migrations (enum values, tables, rules); Investments/Loans/Net worth pages (EN/BN), Playwright wealth flow. ADR-022/023. [docs/api/wealth.md](api/wealth.md).                                                                                    |
| 9     | Done   | 2026-11-07 | Opt-in AI behind the operator switch, per-feature flags and per-scope versioned consent; backend-computed facts with `{{fact}}`-reference prose (no model-written digits) and validation; monthly summary, deterministic unusual-spending detection, saving ideas (cached by facts hash); NL transaction drafts and receipt OCR (redacted input, alias-only refs, magic-byte sniffing, image never stored, review-before-save in the normal form); Anthropic SDK adapter (structured outputs, no tools, refusal fallback) + offline fake provider; per-user/global limits, usage rows without content, delete-my-AI-data, audit; `/app/assistant` (EN/BN) with data-scope controls and disclaimers; Playwright assistant flow. ADR-024. [docs/api/ai.md](api/ai.md).                                                                                |
| 10    | Next   |            | Subscriptions, family workspaces and admin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Phase 2 notes:** readiness checks the database only (Redis is added with BullMQ). The earmark cap and "no postings to archived accounts or categories" are service-level rules for Phases 4–5. The test DB is migrated with `migrate deploy` and never reset automatically.

**Phase 1 known gaps (by design, scheduled later):** health was liveness-only (DB readiness added in Phase 2); no rate limiting or auth yet (Phase 3); web CSP deferred to Phase 7; no Dockerfiles for apps yet (Phase 7); i18n wiring (next-intl) in Phase 6.
