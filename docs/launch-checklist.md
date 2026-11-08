# Launch checklist (blueprint §18, Phase 10)

This file tracks what must be true before TakaWise is opened to the public, and before paid plans or family sharing are switched on.

**Status as of 2026-11-08:** engineering is complete through Phase 10. Every item marked _Owner: business, legal or ops_ is outstanding.

**TakaWise does not claim any legal or regulatory approval.**

## 1. Product and content

| #   | Item                                                                                                  | Owner    | Status                    |
| --- | ----------------------------------------------------------------------------------------------------- | -------- | ------------------------- |
| 1   | Name, domain and brand availability checked                                                           | Business | Open                      |
| 2   | Bangla and English copy reviewed by native speakers (app, e-mails, AI notice)                         | Business | Open                      |
| 3   | Pricing page and in-app plan copy match the configured plans and are honest about what is unavailable | Business | Done (nothing is on sale) |

## 2. Legal and compliance (Bangladesh)

| #   | Item                                                                                                                     | Owner             | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------ |
| 4   | Privacy policy, terms and support process reviewed by qualified counsel (drafts in `/privacy`, `/terms`)                 | Legal             | Open   |
| 5   | Data-protection review: what is stored, retention and export/deletion (see `docs/runbooks`, ADR-024 for AI data)         | Legal             | Open   |
| 6   | AI provider: data-processing terms, retention or zero-retention, processing region; AI notice text (`AI_POLICY_VERSION`) | Legal             | Open   |
| 7   | Payment merchant approval obtained **before** collecting subscriptions; VAT/invoicing and refund policy decided          | Legal and finance | Open   |
| 8   | Financial-promotion wording reviewed; no claim of regulatory approval or regulated advice anywhere                       | Legal             | Open   |

## 3. Payments (needed only to switch on paid plans)

| #   | Item                                                                                                       | Owner       | Status              |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------- | ------------------- |
| 9   | Gateway chosen and approved; adapter written for its callback and signature scheme (ADR-025)               | Engineering | Open (blocked by 7) |
| 10  | `PAYMENT_PROVIDER_SECRET` in the secrets manager; webhook URL registered; staging end-to-end purchase test | Ops         | Open                |
| 11  | Prices set and PRO/FAMILY activated by an admin (`/admin/plans`)                                           | Business    | Open                |

## 4. Security and operations

| #   | Item                                                                                              | Owner       | Status                                                              |
| --- | ------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| 12  | Backup restore tested                                                                             | Ops         | Done in staging-like drill (Phase 7); repeat on real infrastructure |
| 13  | Security and cross-user tests pass: IDOR, cross-tenant family, entitlement and route default-deny | Engineering | Done (`pnpm check`)                                                 |
| 14  | MFA for staff accounts before granting ADMIN in production (ADR-027)                              | Engineering | Open                                                                |
| 15  | Cloud environment provisioned (blockers L2–L5 in `docs/mvp-acceptance.md`)                        | Ops         | Open                                                                |
| 16  | First ADMIN created with the CLI by an operator; staff list reviewed                              | Ops         | Open                                                                |

## 5. Support and people

| #   | Item                                                                                                            | Owner    | Status                                                               |
| --- | --------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| 17  | Support process and response times; staff trained that they cannot and must not ask for PINs, OTPs or passwords | Business | Open                                                                 |
| 18  | Incident response, export and account-deletion processes ready (`docs/runbooks`)                                | Ops      | Runbooks written; account deletion is still a manual support process |
| 19  | Pilot users explicitly consent; no real banking credentials or PINs are used anywhere                           | Business | Open                                                                 |

## Switches to review at launch

| Switch                                                                     | Where          | Launch default                   |
| -------------------------------------------------------------------------- | -------------- | -------------------------------- |
| `AI_ENABLED`, `AI_PROVIDER`, `AI_FEATURES`                                 | env            | Off until item 6 is done         |
| `PAYMENT_PROVIDER`                                                         | env            | `none` until items 7–10 are done |
| PRO and FAMILY `active`                                                    | `/admin/plans` | Inactive until item 11 is done   |
| `billing.checkout`, `family.workspaces`, `support.tickets`, `ai.assistant` | `/admin/flags` | On (each is a kill switch)       |
