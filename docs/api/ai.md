# Opt-in AI and OCR API (Phase 9)

Design: [ADR-024](../architecture/decisions.md). Everything here is **off by default**.

A feature works only when both of these are true:

1. **The operator has switched it on.** `AI_ENABLED=true`, `AI_PROVIDER` is `anthropic` or `fake`, and the feature is listed in `AI_FEATURES`.
2. **The user has allowed the matching consent scope** for the current notice version (`AI_POLICY_VERSION`, exported by `@takawise/contracts`).

All routes are under `/api/v1/ai`, need a bearer token, and use the standard envelope.

## Guarantees

| Guarantee                     | How it is enforced                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numbers come from the backend | Facts are computed in `domain/ai/facts.ts`. The model refers to them as `{{fact_id}}` and may not write digits. `domain/ai/narrative.ts` rejects violations, and the client formats every value.                                             |
| Minimal data leaves           | Insights send aggregates only. Users can withhold category names, budgets and goals. Drafts are redacted (e-mail, links, digit runs of 10 or more) and use aliases (`A1`, `C3`) instead of ids.                                              |
| Nothing is saved by AI        | Drafts return `requiresReview: true`. The user saves through the normal `POST /transactions` with their own Idempotency-Key.                                                                                                                 |
| Receipts are not kept         | Images are held in memory for the call, sniffed by magic bytes and size-capped. They are never written to disk, the database or object storage.                                                                                              |
| Prompt injection is contained | Untrusted text is wrapped in `<untrusted_input>`. Outputs are schema-constrained and re-validated, instruction-like fields are blanked with `SUSPICIOUS_CONTENT`, the model has no tools, and ids map back only to the caller's own records. |
| Cost is bounded               | Limits per user per day and per month, a global daily token breaker, 10 requests per minute per route, and cached insights while the facts are unchanged.                                                                                    |

## Status and consent

| Method | Path                  | Purpose                                                                                                                                                         |
| ------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/ai/status`          | Whether AI is enabled, provider and model, enabled features, per-scope consent, usage against limits, `receiptMaxBytes`.                                        |
| PUT    | `/ai/consents/:scope` | Grant `INSIGHTS`, `TRANSACTION_DRAFT` or `RECEIPT_OCR`. Body `{ "policyVersion": "<AI_POLICY_VERSION>" }`. Any other version returns 400. Returns status.       |
| DELETE | `/ai/consents/:scope` | Withdraw. Always allowed, even when AI is off. Withdrawing `INSIGHTS` also deletes stored insights. Returns status.                                             |
| DELETE | `/ai/data`            | Withdraw every consent and delete stored insights. Returns `{ consentsRevoked, insightsDeleted }`. Usage rows (no content) are kept so that limits still apply. |

Consent changes are audited (`ai.consent.granted`, `ai.consent.revoked`, `ai.data.deleted`) without content.

## Insights

`POST /ai/insights`

```json
{
  "kind": "MONTHLY_SUMMARY",
  "month": "2026-10",
  "currency": "BDT",
  "locale": "bn",
  "include": ["CATEGORY_NAMES", "BUDGETS", "GOALS"],
  "refresh": false
}
```

- `kind` is one of:
  - `MONTHLY_SUMMARY`: totals, change versus last month, top categories, budget use and goal progress.
  - `UNUSUAL_SPENDING`: categories that are at least 1.5× the average of up to 3 earlier months and whose excess is at least 5 % of the month's spending, or new categories that are at least 10 % of it.
  - `SAVINGS_SUGGESTIONS`: savings rate, budget lines at 80 % or more, top unbudgeted categories, and the monthly amount each goal needs.
- `month` must be the current month or one of the 24 months before it. `currency` defaults to the profile currency, and `locale` defaults to the profile locale.
- `include` lists the optional data the user is willing to share. Category names that are left out reach the provider as aliases, but the user still sees the real names.
- `refresh: true` ignores the stored answer. Otherwise an unchanged facts hash returns `cached: true` without calling the provider.

Response:

```json
{
  "kind": "MONTHLY_SUMMARY",
  "month": "2026-10",
  "periodStart": "2026-10-01",
  "periodEnd": "2026-10-31",
  "currency": "BDT",
  "locale": "en",
  "status": "READY",
  "cached": false,
  "generatedAt": "2026-11-07T10:00:00.000Z",
  "model": "claude-opus-5-5",
  "dataScope": ["BUDGETS", "CATEGORY_NAMES", "GOALS"],
  "facts": [
    {
      "id": "expense",
      "type": "money",
      "value": "15000.0000",
      "labelEn": "Spending this month",
      "labelBn": "এই মাসের খরচ"
    }
  ],
  "headline": [
    { "type": "text", "text": "You spent " },
    { "type": "fact", "factId": "expense" }
  ],
  "points": [[{ "type": "text", "text": "…" }]],
  "limitations": ["RECORDED_DATA_ONLY", "SINGLE_CURRENCY"]
}
```

- `status` is one of:
  - `READY`.
  - `NO_DATA`: no posted transactions in that month and currency.
  - `NOTHING_UNUSUAL`: nothing stood out, or there is no earlier month to compare with.

  The provider is not called for `NO_DATA` or `NOTHING_UNUSUAL`.

- `limitations` can include:
  - `MONTH_IN_PROGRESS`
  - `SINGLE_CURRENCY`
  - `RECORDED_DATA_ONLY`
  - `SHORT_HISTORY` (fewer than 3 earlier months)
  - `CATEGORY_NAMES_WITHHELD`
- Fact `type` is one of:
  - `money`: decimal string in `currency`.
  - `percent`: two decimals, signed for changes.
  - `count`
  - `text`: a label such as a category name.

## Drafts

### From text

`POST /ai/drafts/transaction` with the body `{ "text": "Paid 450 for lunch from bKash yesterday", "locale": "en" }`. `text` is 3–300 characters.

### From a receipt

`POST /ai/receipts/extract?locale=bn` takes `multipart/form-data` with one `file` field.

- The file must be JPEG, PNG or WebP, detected from its bytes.
- It must be no larger than `OCR_MAX_BYTES`. Larger files return 413.
- Any other type returns 415 `UNSUPPORTED_MEDIA_TYPE`.

### Response

Both endpoints return the same shape:

```json
{
  "source": "TEXT",
  "requiresReview": true,
  "draft": {
    "type": "EXPENSE",
    "amount": "450.00",
    "currency": "BDT",
    "occurredOn": "2026-11-06",
    "accountId": "…caller's own account…",
    "categoryId": "…",
    "description": "Lunch",
    "missing": [],
    "warnings": []
  },
  "merchant": null,
  "lineItems": [],
  "model": "claude-opus-5-5"
}
```

- Unknown or foreign references become `null` and are listed in `missing`. Dates in the future or more than 366 days old are dropped with `DATE_OUT_OF_RANGE`.
- `warnings` can include:
  - `SUSPICIOUS_CONTENT`
  - `MULTIPLE_TRANSACTIONS`
  - `DATE_OUT_OF_RANGE`
  - `CURRENCY_MISMATCH`
  - `LOW_CONFIDENCE`
- A receipt is always an `EXPENSE`.

## Errors

| Status | Code                     | When                                                                                |
| ------ | ------------------------ | ----------------------------------------------------------------------------------- |
| 403    | `FEATURE_DISABLED`       | AI is off or the feature flag is not set                                            |
| 403    | `AI_CONSENT_REQUIRED`    | No current consent for the scope. `details[0].message` names the scope.             |
| 429    | `AI_LIMIT_REACHED`       | Per-user daily request or monthly token limit                                       |
| 502    | `AI_OUTPUT_INVALID`      | Refusal, truncation, schema mismatch or a broken narrative rule. Nothing is stored. |
| 503    | `AI_UNAVAILABLE`         | Provider error, timeout, rate limit, or the global token breaker                    |
| 413    | `PAYLOAD_TOO_LARGE`      | Receipt too large                                                                   |
| 415    | `UNSUPPORTED_MEDIA_TYPE` | Not a JPEG, PNG or WebP image                                                       |

Every provider attempt writes one `ai_requests` row (`SUCCEEDED`, `REJECTED` or `FAILED`, with tokens and duration). It never stores the prompt, the answer, the receipt or what the user typed.

## Configuration

See `apps/api/.env.example`:

| Variable                 | Default           | Notes                                                                                             |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------- |
| `AI_ENABLED`             | `false`           | Master switch                                                                                     |
| `AI_PROVIDER`            | `none`            | `anthropic` or `fake`. `fake` is rejected when `NODE_ENV=production`.                             |
| `AI_PROVIDER_API_KEY`    | —                 | Required for `anthropic`. Inject it from the secrets manager and never put it in `NEXT_PUBLIC_*`. |
| `AI_MODEL`               | `claude-opus-5-5` |                                                                                                   |
| `AI_FEATURES`            | all five          | Comma-separated feature flags                                                                     |
| `AI_USER_DAILY_REQUESTS` | `30`              | Provider calls per user in a rolling 24 h                                                         |
| `AI_USER_MONTHLY_TOKENS` | `300000`          | Per user per UTC month                                                                            |
| `AI_GLOBAL_DAILY_TOKENS` | `5000000`         | Cost circuit breaker                                                                              |
| `AI_TIMEOUT_MS`          | `60000`           | Per provider call (one retry)                                                                     |
| `OCR_MAX_BYTES`          | `4000000`         | At most 5 MB, the provider's image limit                                                          |

CI and local Playwright runs use `AI_PROVIDER=fake`, so no key is needed and nothing leaves the machine.

## Tests

| Layer    | File                                                  | Covers                                                                                                                                                                                                               |
| -------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit     | `apps/api/src/domain/ai/ai-domain.spec.ts`            | Redaction (Bangla digits, phone, card), injection heuristics, fact builders, outlier detection, narrative rules, draft mapping                                                                                       |
| Unit     | `apps/api/src/modules/ai/providers/providers.spec.ts` | SDK request shape (structured output, fallback, no tools, image block), stop-reason and error mapping, fake provider, image sniffing                                                                                 |
| Unit     | `apps/api/src/config/env.spec.ts`                     | AI configuration rules                                                                                                                                                                                               |
| API + DB | `apps/api/test/ai/ai-flow.int-spec.ts`                | Flags, consent and versioning, audit, minimisation (no ids, notes or account names in prompts), cache and refresh, invalid output, outage, limits, revoke and delete, IDOR-safe drafts, receipt type and size checks |
| Web      | `apps/web/src/features/ai/assistant-view.test.tsx`    | Disabled state, consent gating and copy, fact formatting (Bangla digits), limitations and scope                                                                                                                      |
| E2E      | `apps/web/e2e/assistant.spec.ts`                      | Consent, then text draft, review and save, then summary, cache, and delete my AI data                                                                                                                                |
