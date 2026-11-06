# Dependency & Secret Scanning

> Phase 7 · 2026-11-06 · CI job `security` runs on every push and PR (`.github/workflows/ci.yml`).

| Check                   | Tool                                                                       | Gate                              |
| ----------------------- | -------------------------------------------------------------------------- | --------------------------------- |
| Production dependencies | `pnpm audit --prod --audit-level high`                                     | fails on high or critical         |
| Secrets in git history  | gitleaks v8.21.2 (`detect`, full history, redacted output)                 | fails on any finding              |
| Container images        | Trivy 0.57.1 on the API and web images (`--ignore-unfixed`, HIGH/CRITICAL) | fails on fixable high or critical |

## Findings at release preparation

| Package                                       | Severity | Path                                          | Decision                                                                                                                                                                                  |
| --------------------------------------------- | -------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| multer < 2.5.0 (DoS via pending `fileFilter`) | high     | `@nestjs/platform-express` → multer 2.4.0     | **Fixed** with a pnpm override to 2.5.0 (`pnpm-workspace.yaml`). TakaWise registers no multipart routes, so it was not exploitable                                                        |
| minimatch < 11.0.1 (ReDoS via globparts)      | moderate | `@takawise/eslint-config` → typescript-eslint | **Accepted.** Lint tooling only; it is never bundled into the API or web runtime, and the patterns come from our own config. We will upgrade once typescript-eslint moves to minimatch 11 |
| deepmerge ≤ 4.3.1 (prototype poisoning)       | low      | nestjs-zod → deepmerge                        | **Accepted.** No patched version exists. It is used only to merge our own Swagger/OpenAPI objects at start-up, never on request data. Revisit when nestjs-zod updates                     |

- **gitleaks:** 7 commits scanned, no leaks.
- **Trivy (images):**
  - The first API image scan found 7 fixable HIGH findings: `undici` and `brace-expansion` inside the base image's bundled **npm**, plus multer 2.4.0 from an image built before the override.
  - Fix: remove npm and corepack from the runtime layers of both images (they are not needed at runtime) and rebuild.
  - Re-scan result: **API 0 and web 0** HIGH/CRITICAL (OS: alpine 3.24.4).
- **Local `.env` files** are git-ignored, and `.dockerignore` keeps them out of image build contexts.

## Process

1. A **new high or critical finding** fails CI. Fix it with an upgrade or an override, or record a dated, justified exception in this file and add `--ignore-*` flags only for that advisory.
2. Re-run the audit before each release. Dependabot or Renovate can be enabled on GitHub to open upgrade PRs.
3. **If a secret is ever committed:** rotate it immediately (see [../runbooks/secret-rotation.md](../runbooks/secret-rotation.md)). Rewriting history is not enough, because the secret must be considered leaked.
