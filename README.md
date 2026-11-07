# TakaWise

Bangladesh-first personal finance management SaaS: accounts, double-entry ledger, income and expenses, transfers, budgets, savings goals and reports. TakaWise is a **recordkeeping and planning tool**. It is not a bank, wallet, lender or financial adviser, and it never asks for bank or MFS passwords, PINs or OTPs.

- Plan: [docs/implementation-plan.md](docs/implementation-plan.md)
- Architecture and decisions (ADRs): [docs/architecture/decisions.md](docs/architecture/decisions.md)

## Stack

| Layer    | Tech                                                                            |
| -------- | ------------------------------------------------------------------------------- |
| Web      | Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui                    |
| API      | NestJS 11 (modular monolith), Zod validation (`nestjs-zod`), pino logs, Swagger |
| Shared   | `@takawise/contracts`: Zod schemas and types used by web and API                |
| Data     | PostgreSQL 17 (+ Prisma from Phase 2), Redis 7 (+ BullMQ)                       |
| Dev mail | Mailpit                                                                         |
| Tooling  | pnpm 10 workspaces, TypeScript 6, ESLint 9, Prettier, Jest + SWC, Vitest        |

## Repository layout

```
apps/web            Next.js app            -> http://localhost:3100
apps/api            NestJS REST API        -> http://localhost:4000/api/v1
packages/contracts  shared Zod schemas/types
packages/tsconfig   shared tsconfig presets
packages/eslint-config  shared ESLint flat configs
infra/docker        container init scripts
docs/               plan, ADRs, runbooks
```

## Prerequisites

- **Node.js 24** (see `.nvmrc`)
- **pnpm 10**: `npm i -g pnpm@10` (or `corepack enable`, which may need an admin shell on Windows)
- **Docker** with Compose v2 (for PostgreSQL, Redis and Mailpit)

### Local ports

Ports were chosen to avoid clashing with other local projects. Override them in a root `.env` (see `.env.example`).

| Service           | Host port                          |
| ----------------- | ---------------------------------- |
| Web               | 3100                               |
| API               | 4000 (Swagger: `/api/docs`)        |
| PostgreSQL        | 5442 (`takawise`, `takawise_test`) |
| Redis             | 6389                               |
| Mailpit SMTP / UI | 1035 / http://localhost:8035       |

## Getting started

**Windows (PowerShell)**

```powershell
pnpm install
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
pnpm infra:up        # docker compose up -d --wait
pnpm db:deploy       # apply migrations
pnpm db:seed         # system categories + ledger templates
pnpm dev             # contracts watcher + API + web
```

**macOS / Linux (bash/zsh)**

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm infra:up
pnpm db:deploy
pnpm db:seed
pnpm dev
```

Then open http://localhost:3100, http://localhost:4000/api/v1/health and http://localhost:4000/api/v1/health/ready.

## Scripts (repo root)

| Script                                  | What it does                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm dev`                              | Builds shared packages, then runs contracts/API/web in watch mode                         |
| `pnpm dev:api` / `pnpm dev:web`         | Run a single app                                                                          |
| `pnpm build`                            | Production build of every workspace                                                       |
| `pnpm lint`                             | ESLint (type-aware) everywhere                                                            |
| `pnpm typecheck`                        | `tsc --noEmit` everywhere                                                                 |
| `pnpm test`                             | Vitest (contracts, web) + Jest (API unit, e2e and DB integration — needs `pnpm infra:up`) |
| `pnpm --filter @takawise/api test:unit` | API tests that need no database                                                           |
| `pnpm db:migrate`                       | Dev: create and apply a migration from `schema.prisma` changes                            |
| `pnpm db:deploy` / `db:status`          | Apply pending migrations / show migration status                                          |
| `pnpm db:seed`                          | Idempotent reference data (categories, ledger templates)                                  |
| `pnpm db:studio`                        | Prisma Studio                                                                             |
| `pnpm db:reset`                         | ⚠ Drops **all** local data, then re-migrates and seeds (dev only)                         |
| `pnpm format` / `format:check`          | Prettier                                                                                  |
| `pnpm check`                            | Everything CI runs, in order                                                              |
| `pnpm infra:up` / `infra:down`          | Start or stop local PostgreSQL, Redis and Mailpit                                         |

## API conventions

- Base path `/api/v1`. Swagger UI is at `/api/docs` and is **disabled in production**.
- Success: `{ "data": ..., "meta": { "requestId": "..." } }`
- Paginated: `meta` also has `page, pageSize, total, totalPages`.
- Error: `{ "error": { "code", "message", "details": [{ "field", "message" }], "requestId" } }`
- Every response carries an `X-Request-Id` header. A well-formed incoming one is reused.
- Money is always sent as a **decimal string** (e.g. `"450.00"`), never a JSON number.
- Financial commands (`POST /accounts`, `/transactions`, `/transfers`, `…/reverse`, goal contributions) require an `Idempotency-Key: <uuid>` header. See [docs/api/ledger.md](docs/api/ledger.md) for posting rules, balances and errors.
- Budgets, savings goals (earmark model), reminders, notifications and background jobs: [docs/api/planning.md](docs/api/planning.md).
- Dashboard, reports and CSV export: [docs/api/reports.md](docs/api/reports.md).
- Investments, loans, net-worth items and net worth (Phase 8): [docs/api/wealth.md](docs/api/wealth.md). Rates, valuations and schedules are the user's own figures; nothing is fetched or invented.
- Opt-in AI insights, transaction drafts and receipt OCR (Phase 9): [docs/api/ai.md](docs/api/ai.md). Off by default (`AI_ENABLED=false`). The backend computes every number, nothing is saved without the user confirming it, and `AI_PROVIDER=fake` runs everything offline for development.

## End-to-end tests

Playwright drives the real stack (web → API → PostgreSQL/Redis) and reads verification codes from Mailpit:

```bash
pnpm infra:up && pnpm db:deploy && pnpm db:seed
pnpm build
pnpm --filter @takawise/web exec playwright install chromium   # first time only
pnpm --filter @takawise/web e2e    # starts API + web unless already running
```

## Release & operations

- **Images:** `docker build -f infra/docker/api.Dockerfile -t takawise-api .` (add `--target migrator` for the migration image) and `docker build -f infra/docker/web.Dockerfile --build-arg NEXT_PUBLIC_API_BASE_URL=… -t takawise-web .`. Both run as non-root with health checks.
- **CI scans:** `pnpm audit --prod`, gitleaks (secrets) and Trivy (images). Decisions on accepted advisories: [docs/security/dependency-audit.md](docs/security/dependency-audit.md); endpoint review: [docs/security/endpoint-review.md](docs/security/endpoint-review.md).
- **Observability:** JSON logs with request IDs and redaction, `/api/v1/health`, `/api/v1/health/ready`, Prometheus `/api/v1/metrics` (`METRICS_TOKEN`).
- **Load test:** `infra/load/k6-core-reads.js` with data from `apps/api/scripts/seed-load-test.ts` — results in [docs/ops/load-test.md](docs/ops/load-test.md).
- **Scripts:** `infra/scripts/restore-drill.sh`, `verify-ledger.sql`, `smoke.sh`, `deploy.sh` (placeholder until a target exists).
- **Runbooks:** [deployment](docs/runbooks/deployment.md), [migrations](docs/runbooks/migrations.md), [backup & restore](docs/runbooks/backup-restore.md), [incident response](docs/runbooks/incident-response.md), [secret rotation](docs/runbooks/secret-rotation.md). MVP sign-off: [docs/mvp-acceptance.md](docs/mvp-acceptance.md).

## Database

PostgreSQL via Prisma 7. Financial invariants are enforced **in the database as well as in services**: balanced journals, immutable posted history and cross-user foreign keys. See [docs/architecture/erd.md](docs/architecture/erd.md) for the ERD and the full constraint catalogue. DB integration tests run against `takawise_test` (override with `TEST_DATABASE_URL`, whose name must end in `_test`).

## Configuration

Environment variables are validated at boot by [apps/api/src/config/env.ts](apps/api/src/config/env.ts), and the API **refuses to start** on invalid or unsafe configuration. In particular:

- Production requires explicit `CORS_ORIGINS`, `APP_BASE_URL` and `SMTP_URL`, plus Secure cookies.
- `JWT_ACCESS_SECRET` and `AUTH_HMAC_SECRET` are required (≥ 32 chars, different from each other). The `change-me…` placeholders in `.env.example` work locally and are rejected in production.
- `DEV_LOG_OTP=true` is rejected unless `NODE_ENV=development`.

Local email goes to Mailpit: open http://localhost:8035 to read verification and reset codes. The auth model, cookies and every auth variable are documented in [docs/api/auth.md](docs/api/auth.md).

Only placeholders live in `.env.example` files. Never commit real secrets, and never put secrets in `NEXT_PUBLIC_*` variables.

## Troubleshooting

- **Port already allocated** when running `pnpm infra:up`: another project is using the port. Set `POSTGRES_PORT` or `REDIS_PORT` in a root `.env`.
- **`corepack enable` fails with EPERM on Windows**: install pnpm with `npm i -g pnpm@10` instead.
