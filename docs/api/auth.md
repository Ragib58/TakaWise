# Authentication & Sessions

> Phase 3 · 2026-11-05 · Decision record: [ADR-011](../architecture/decisions.md#adr-011--authentication--sessions). Swagger (`/api/docs`, non-production) is the canonical request/response reference.

## Model at a glance

| Piece         | What it is                                                                                        | Where it lives                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Access token  | HS256 JWT (`sub` = user, `sid` = session, `typ` = access), 15 min                                 | Web app **memory only**, sent as `Authorization: Bearer`                                                     |
| Refresh token | 256-bit random, **rotated on every refresh**                                                      | `tw_rt` cookie: HttpOnly, SameSite=Strict, Path=`/api/v1/auth`. DB stores only its SHA-256                   |
| CSRF token    | Random value, double-submit                                                                       | `tw_csrf` cookie (readable by JS), echoed in the `X-CSRF-Token` header on `/auth/refresh` and `/auth/logout` |
| Session       | One row per login, chained by `family_id` across rotations                                        | `sessions` table                                                                                             |
| Codes         | 6-digit email OTP: verify (10 min) / reset (15 min), 5 attempts, 60 s resend cooldown, single use | `verification_tokens` (HMAC only)                                                                            |
| Passwords     | Argon2id, m = 19 MiB, t = 2, p = 1. 8–128 chars. Common/contextual passwords rejected             | `users.password_hash`                                                                                        |

Every authenticated request also checks that the token's **session is still live and the user is ACTIVE**. Logout, password reset, "log out everywhere" and reuse detection therefore take effect immediately, not when the access token expires.

## Endpoints (`/api/v1`)

| Method    | Path                        | Auth          | Notes                                                                                                                                              |
| --------- | --------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST      | `/auth/register`            | public        | 202 `verification_required`. The response is identical for existing emails (no enumeration). The real owner gets an "account exists" email instead |
| POST      | `/auth/verify-email`        | public        | Correct code → account ACTIVE **and signed in** (tokens + cookies)                                                                                 |
| POST      | `/auth/resend-verification` | public        | 202 always. Respects the cooldown                                                                                                                  |
| POST      | `/auth/login`               | public        | 401 `INVALID_CREDENTIALS` (same for unknown email and wrong password). 403 `EMAIL_NOT_VERIFIED` / `ACCOUNT_DISABLED` only after a correct password |
| POST      | `/auth/refresh`             | cookie + CSRF | Rotates. Reusing a rotated token revokes the **whole family** and is audited                                                                       |
| POST      | `/auth/logout`              | cookie + CSRF | Revokes this session and clears cookies                                                                                                            |
| POST      | `/auth/logout-all`          | bearer        | Revokes every session of the user                                                                                                                  |
| POST      | `/auth/forgot-password`     | public        | 202 always                                                                                                                                         |
| POST      | `/auth/reset-password`      | public        | Policy is checked **before** the code is consumed. Success revokes all sessions                                                                    |
| GET       | `/auth/sessions`            | bearer        | Own live sessions, with `current` flag                                                                                                             |
| DELETE    | `/auth/sessions/:id`        | bearer        | Own session only. Another user's id → 404                                                                                                          |
| GET/PATCH | `/users/me`                 | bearer        | Profile: `fullName`, `locale` (`en`/`bn`), IANA `timezone`, `defaultCurrency`                                                                      |
| POST      | `/users/me/password`        | bearer        | Needs the current password. Signs out **other** sessions                                                                                           |

All request bodies are strict: unknown keys (such as `userId`) → 400 `VALIDATION_ERROR`. Identity comes only from the verified token (`@CurrentUser()`), and every route is protected unless marked `@Public()`.

## CSRF and cookies

- Bearer-token routes are not CSRF-exposed, because browsers never attach an `Authorization` header cross-site.
- The two cookie routes require **both** checks:
  1. If an `Origin` header is present, it must be in `CORS_ORIGINS`.
  2. `X-CSRF-Token` must equal the `tw_csrf` cookie, compared in constant time.
- `SameSite=Strict` cookies are sent only for same-_site_ requests. Keep web and API on one registrable domain (`app.example.com` + `api.example.com`) and set `COOKIE_DOMAIN=.example.com` so the web app can read `tw_csrf`. On localhost, ports do not matter (`localhost:3100` and `localhost:4000` share cookies).
- The web client refreshes **single-flight**. Two parallel refreshes with one token look like token theft to the server.

## Rate limiting

- Global: 120 requests/min per IP.
- Login, verify-email, refresh and reset: 10/min per IP.
- Register, resend and forgot: 5/min per IP.
- Per-account protection comes from the code rules (5 attempts per code, 60 s resend cooldown).
- Counters are **in memory**, which is correct for a single API instance. Move them to Redis storage before scaling out (Phase 7).
- `TRUST_PROXY` must equal the number of proxies in front of the API, or every client will share the proxy's IP.

## Environment variables

| Variable                   | Required | Default                              | Notes                                                                                                                                          |
| -------------------------- | -------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`        | ✅       | —                                    | ≥ 32 chars. Placeholder values are rejected in production                                                                                      |
| `AUTH_HMAC_SECRET`         | ✅       | —                                    | ≥ 32 chars, **must differ** from the JWT secret. Keys OTP and IP hashes                                                                        |
| `ACCESS_TOKEN_TTL_SECONDS` |          | 900                                  | 60–3600                                                                                                                                        |
| `REFRESH_TOKEN_TTL_DAYS`   |          | 30                                   | Sliding: each rotation issues a fresh expiry                                                                                                   |
| `COOKIE_SECURE`            |          | prod `true`, else `false`            | Cannot be `false` in production                                                                                                                |
| `COOKIE_DOMAIN`            |          | unset                                | Parent domain for `tw_csrf`                                                                                                                    |
| `TRUST_PROXY`              |          | 0                                    | Proxy hops                                                                                                                                     |
| `THROTTLE_ENABLED`         |          | true                                 | Disable only in tests                                                                                                                          |
| `SMTP_URL`                 | prod ✅  | unset                                | Dev: `smtp://localhost:1035` (Mailpit UI http://localhost:8035). Unset outside production → emails are suppressed and logged with codes masked |
| `EMAIL_FROM`               |          | `TakaWise <no-reply@takawise.local>` |                                                                                                                                                |
| `DEV_LOG_OTP`              |          | false                                | Prints codes to the console. **Boot fails** unless `NODE_ENV=development`                                                                      |

`JWT_REFRESH_SECRET` from the blueprint's variable list is **not used**. Refresh tokens are opaque random values, not JWTs, so they need no signing key. Their SHA-256 is stored. `AUTH_HMAC_SECRET` covers the low-entropy values (OTPs, IPs) that do need a key.

## Audit events

`auth.register`, `auth.register.existing_email`, `auth.verification_code.sent`, `auth.email_verified`, `auth.login.succeeded`, `auth.login.failed`, `auth.refresh.reuse_detected`, `auth.logout`, `auth.logout_all`, `auth.password_reset.requested`, `auth.password_reset.completed`, `auth.password_changed`, `user.profile.updated`.

Each event carries a request ID and an HMAC of the IP. Events never include passwords, tokens or codes, and the tests assert this.

## Known limitations

- There is no MFA yet. The settings page is "MFA-ready" per the blueprint, and TOTP can be added later.
- Account deletion and data export arrive with the settings work in Phase 6–7.
- Email is sent inline during the request and moves to the BullMQ outbox in Phase 5. A failed send is logged, and the user can request a new code.
