# Runbook — Deployment

## Pipeline

```
push/PR ──► CI: security (audit + gitleaks) · verify (format, lint, typecheck, unit/integration, build,
                migration drift) · e2e (Playwright on the real stack) · images (build + Trivy)
main  ───► Deploy: publish images (GHCR, tag = commit SHA)
               └► staging: web image (staging API URL) → migrate → rollout → smoke test
                     └► production: ⏸ manual approval (GitHub environment reviewers)
                                    → DB snapshot → migrate → rollout → smoke test
```

The `Deploy` workflow does nothing until the repository variable `DEPLOY_ENABLED=true` is set. `infra/scripts/deploy.sh` deliberately **fails** until a real target is wired in.

## Target architecture (blueprint §12)

| Component  | Service                                                                                                                           | Notes                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Web        | ECS Fargate (or Vercel/Amplify) running `takawise-web:<sha>-<env>`                                                                | `NEXT_PUBLIC_API_BASE_URL` is compiled in, so build one image per environment                   |
| API        | ECS Fargate, ≥ 2 tasks, `takawise-api:<sha>`                                                                                      | health check `/api/v1/health`, readiness `/api/v1/health/ready`; `TRUST_PROXY=1` behind the ALB |
| Migrations | one-off ECS task, `takawise-migrator:<sha>`                                                                                       | runs before each rollout                                                                        |
| Database   | RDS PostgreSQL 17, private subnets, encrypted, PITR                                                                               | the `pg_trgm` extension is required                                                             |
| Redis      | ElastiCache (TLS + auth)                                                                                                          | `rediss://`; jobs and shared rate limits                                                        |
| Secrets    | Secrets Manager or SSM → task environment                                                                                         | see [secret-rotation.md](secret-rotation.md)                                                    |
| Email      | SMTP relay (e.g. SES SMTP)                                                                                                        | `SMTP_URL`                                                                                      |
| Monitoring | CloudWatch logs (JSON), Prometheus or ADOT scraping `/api/v1/metrics` with `METRICS_TOKEN`, alerts on 5xx rate, p95 and readiness |                                                                                                 |

## One-time setup checklist

1. Provision the resources above per environment (staging and production), with separate accounts or credentials.
2. In GitHub:
   - Create the environments `staging` and `production`. `production` must require reviewers and allow only the `main` branch.
   - Add the variables `API_URL` and `WEB_URL` per environment, plus `DEPLOY_ENABLED=true`.
   - Configure OIDC trust to AWS. There are no static keys.
3. Implement the three actions in `infra/scripts/deploy.sh` (`snapshot`, `migrate`, `rollout`) against the provisioned services.
4. Set the API environment variables per [../api/auth.md](../api/auth.md) and `apps/api/.env.example`. In production, provide all of the following, which are required:
   - `NODE_ENV=production`
   - `CORS_ORIGINS`, `APP_BASE_URL`, `DATABASE_URL`, `REDIS_URL`, `SMTP_URL`, `EMAIL_FROM`
   - `JWT_ACCESS_SECRET`, `AUTH_HMAC_SECRET`, `METRICS_TOKEN`
   - `TRUST_PROXY`
   - `COOKIE_DOMAIN` when web and API are on sibling subdomains
5. Run the staging restore drill and the load test on staging ([../ops/load-test.md](../ops/load-test.md)).

## Manual production release

1. Confirm that staging is green: smoke test, key flows clicked through, and `verify-ledger.sql` clean.
2. Approve the `production` job in GitHub Actions.
3. Watch error rate, p95 and readiness for 30 minutes. Roll back by re-running the workflow for the previous SHA ([migrations.md](migrations.md)).
