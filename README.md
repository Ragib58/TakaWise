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
- Financial commands (`POST /accounts`, `/transactions`, `/transfers`, `…/reverse`) require an `Idempotency-Key: <uuid>` header. See [docs/api/ledger.md](docs/api/ledger.md) for posting rules, balances and errors.

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
