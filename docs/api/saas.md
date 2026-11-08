# Subscriptions, family and admin API (Phase 10)

Design:

- [ADR-025](../architecture/decisions.md) covers plans, entitlements and billing.
- [ADR-026](../architecture/decisions.md) covers family workspaces.
- [ADR-027](../architecture/decisions.md) covers staff roles, the admin route group and support.

All routes are under `/api/v1` and use the standard envelope. Every route needs a bearer token except the provider webhook.

## Plans and entitlements

| Entitlement        | FREE (seeded) | PRO (seeded, inactive) | FAMILY (seeded, inactive) |
| ------------------ | ------------- | ---------------------- | ------------------------- |
| `maxAccounts`      | 10            | unlimited              | unlimited                 |
| `aiInsights`       | yes           | yes                    | yes                       |
| `aiDrafts`         | yes           | yes                    | yes                       |
| `receiptOcr`       | no            | yes                    | yes                       |
| `familyWorkspace`  | no            | no                     | yes                       |
| `maxFamilyMembers` | 2             | 2                      | 6                         |

- Admins can change every value, the price and whether a plan is purchasable. The seed never overwrites their changes.
- Limits are checked on the server on every request:
  - `maxAccounts` counts active everyday accounts and is checked when an account is created.
  - The AI features are checked after the feature flag and the user's consent.
  - Family checks apply to creating a workspace, inviting and accepting.
- A refusal returns 403 `PLAN_REQUIRED`, and `details[0].field` names the entitlement.

## Billing

| Method | Path                                 | Notes                                                                                                                                                                                                              |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/billing`                           | Effective plan, live subscription, effective entitlements (including family cover), account usage, purchasable plans, provider.                                                                                    |
| POST   | `/billing/checkout`                  | `{ planCode }`. Returns `{ checkoutId, url, expiresAt }`; send the browser to `url`. Returns 400 for FREE, unknown or inactive plans and 403 when no provider is configured or the `billing.checkout` flag is off. |
| POST   | `/billing/subscription/cancel`       | Cancels at the end of the period. Access continues until `currentPeriodEnd`.                                                                                                                                       |
| POST   | `/billing/webhooks/:provider`        | **Public.** Provider → TakaWise. See the next section.                                                                                                                                                             |
| POST   | `/billing/fake/complete/:checkoutId` | Development only (`PAYMENT_PROVIDER=fake`, never production). Sends a signed `checkout.completed` for the caller's own checkout.                                                                                   |
| GET    | `/features`                          | Runtime feature flags, used by the UI to hide features. This is not a security control.                                                                                                                            |

### Webhooks

- **Signature.** The `takawise-signature` header has the form `t=<unix seconds>,v1=<hex HMAC-SHA256(PAYMENT_PROVIDER_SECRET, "<t>.<raw body>")>`.
  - It is verified over the raw bytes before the body is parsed, and `t` must be within ±300 s.
  - A missing, malformed, stale or mismatched signature returns 401 `INVALID_SIGNATURE`.
  - A provider other than the configured one returns 404.
- **Body.** `{ "id": "evt_…", "type": "…", "data": { "checkoutId"?, "subscriptionId"?, "currentPeriodEnd"? } }`.
- **Event types:**
  - `checkout.completed`: ends any live subscription and creates an `ACTIVE` one for **our** checkout's user and plan.
  - `subscription.renewed`: extends the period, or uses `currentPeriodEnd` if given.
  - `subscription.canceled`: ends the subscription now.
  - `payment.failed`: sets `PAST_DUE`. Access continues until the period ends.
  - Any other type is stored and ignored.
- **Idempotency.** The event is applied and recorded in one transaction. A repeated `(provider, event id)` returns `{ duplicate: true }` and changes nothing.
- **Storage.** `payment_events` are append-only and store a SHA-256 hash of the body, never the body. No card or wallet data ever reaches TakaWise.

## Family workspaces

| Method        | Path                                               | Who                                                                                                                                                         |
| ------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET           | `/family/workspaces`                               | Own active memberships                                                                                                                                      |
| POST          | `/family/workspaces`                               | Plan with `familyWorkspace`. One owned workspace per user.                                                                                                  |
| GET           | `/family/workspaces/:id`                           | Active member (404 otherwise). Invitations are shown to the owner and admins only.                                                                          |
| PATCH, DELETE | `/family/workspaces/:id`                           | Owner                                                                                                                                                       |
| POST          | `/family/workspaces/:id/invitations`               | Owner or admin; only the owner may invite an admin. Checks seats against the owner's plan, counting pending invitations.                                    |
| DELETE        | `/family/workspaces/:id/invitations/:invitationId` | Owner or admin                                                                                                                                              |
| POST          | `/family/invitations/accept`                       | `{ code }`. Must be signed in with the invited e-mail. Single use. Throttled to 5 per minute. Any failure returns 400 `INVALID_OR_EXPIRED_CODE`.            |
| DELETE        | `/family/workspaces/:id/members/:userId`           | Owner or admin removes someone (only the owner removes admins); removing yourself means leaving. The owner cannot leave. Also revokes that person's shares. |
| PATCH         | `/family/workspaces/:id/members/:userId`           | Owner: `{ role: ADMIN or MEMBER }`                                                                                                                          |
| POST          | `/family/workspaces/:id/shares`                    | `{ resourceType: ACCOUNT, BUDGET or GOAL, resourceId }`. Only your own resource; anyone else's returns 404.                                                 |
| DELETE        | `/family/workspaces/:id/shares/:shareId`           | The person who shared it, or the owner                                                                                                                      |
| GET           | `/family/workspaces/:id/shared`                    | Active member: live, read-only summaries of active shares                                                                                                   |

- Each shared item appears as a summary, never with transactions, notes or a goal's linked account:
  - Account: name, type, currency and balance.
  - Budget: name, month, spent, limit and percentage used.
  - Goal: name, target, saved, percentage and target date.
- Membership is checked on every request, so removal takes effect immediately.

## Support

| Method | Path                            | Notes                                                                          |
| ------ | ------------------------------- | ------------------------------------------------------------------------------ |
| POST   | `/support/tickets`              | `{ subject, category, body }`. Throttled. Respects the `support.tickets` flag. |
| GET    | `/support/tickets`, `/:id`      | Your own tickets only (404 otherwise)                                          |
| POST   | `/support/tickets/:id/messages` | Your reply. Reopens a resolved ticket; refused (409) on a closed one.          |

## Admin route group (`/admin/*`)

Staff only. The guard reads `users.platform_role` from the database on every request.

| Path                                                                                          | SUPPORT | ADMIN |
| --------------------------------------------------------------------------------------------- | :-----: | :---: |
| `GET /admin/me`                                                                               |    ✓    |   ✓   |
| `GET /admin/users?email=`, `GET /admin/users/:id` (limited metadata)                          |    ✓    |   ✓   |
| `GET /admin/tickets`, `GET /admin/tickets/:id`, `POST …/messages`, `PATCH /admin/tickets/:id` |    ✓    |   ✓   |
| `PATCH /admin/users/:id/role` (never yourself)                                                |         |   ✓   |
| `POST`, `DELETE /admin/users/:id/subscription` (complimentary grant or end)                   |         |   ✓   |
| `GET /admin/plans`, `PATCH /admin/plans/:code`                                                |         |   ✓   |
| `GET /admin/subscriptions?status=`                                                            |         |   ✓   |
| `GET /admin/feature-flags`, `PATCH /admin/feature-flags/:key`                                 |         |   ✓   |
| `GET /admin/analytics` (aggregate counts only)                                                |         |   ✓   |

- **Bootstrapping the first admin.** Run `pnpm --filter @takawise/api admin:role -- someone@example.com ADMIN`. It needs `DATABASE_URL` and is audited with `via: cli`.
- **What staff can and cannot see.** No admin endpoint returns balances, transactions, budgets, goals, AI data or notes. Staff use the normal user endpoints like anyone else, so ownership checks still apply to them.

## Configuration

| Variable                  | Default | Notes                                                                                                                       |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `PAYMENT_PROVIDER`        | `none`  | Either `none` or `fake`. `fake` is rejected when `NODE_ENV=production`.                                                     |
| `PAYMENT_PROVIDER_SECRET` | —       | Webhook signing secret, at least 32 characters. Required whenever the provider is not `none`. Keep it in a secrets manager. |
| `CHECKOUT_TTL_MINUTES`    | `30`    |                                                                                                                             |
| `FAMILY_INVITE_TTL_HOURS` | `168`   |                                                                                                                             |

## Tests

| Layer    | File                                                 | Covers                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit     | `apps/api/src/domain/saas/saas-domain.spec.ts`       | Effective subscription, fail-closed plan JSON, family cover, account limit, month arithmetic, signatures (tamper, wrong secret, stale, malformed), invite codes                                                                                                                                                                                                   |
| Unit     | `apps/api/src/config/env.spec.ts`                    | Payment configuration rules                                                                                                                                                                                                                                                                                                                                       |
| Unit     | `apps/api/test/security/route-inventory.e2e-spec.ts` | The webhook is the only new public route                                                                                                                                                                                                                                                                                                                          |
| API + DB | `apps/api/test/saas/saas-flow.int-spec.ts`           | Entitlement enforcement, signed and idempotent webhooks, cancellation, fake-checkout ownership, append-only events, staff role boundaries, limited metadata and no financial content, role changes and audit, plan validation, tickets, kill switch, family invitations, cover, explicit sharing, immediate revocation, member roles, DB share-ownership backstop |
| API + DB | `apps/api/test/ai/ai-flow.int-spec.ts`               | Receipt OCR needs a plan that includes it                                                                                                                                                                                                                                                                                                                         |
| Web      | `apps/web/src/features/saas/saas-views.test.tsx`     | Billing view (not on sale, fake checkout, family cover) and the admin gate                                                                                                                                                                                                                                                                                        |
| E2E      | `apps/web/e2e/saas.spec.ts`                          | CLI staff bootstrap, then admin grant, family invitation, sharing, removal, and a support round trip                                                                                                                                                                                                                                                              |
