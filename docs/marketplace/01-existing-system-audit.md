# AIEC Lift Marketplace — Existing System Audit (Phase 1)

Date: 24 November 2026. Audited code: `prashantashwable-cmyk/AIEC-PLATFORM-1` at commit `5f077d5`,
imported unchanged into this repository as commit `6e14617` so that every marketplace change can be
reviewed against it.

> The `Gptmarket` repository was empty (no branches, no files). The owner confirmed that
> `AIEC-PLATFORM-1` is the existing application to audit and build on.

## 1. How the audit was done

The source was read directly (services, migrations, row-level security, pages, tests, scripts and
documentation), then the baseline was installed and run against a local PostgreSQL 16:

| Check | Command | Result on the unchanged baseline |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | 0 errors |
| Lint | `npm run lint` | 0 problems |
| Translations | `npx tsx scripts/i18n-scan.ts` | 973 keys, 0 missing in en / hi / mr |
| Automated tests | `npm test` (unit + integration, real Postgres) | **57 / 57 passed** |

## 2. What the existing system is

| Item | Finding |
| --- | --- |
| Entry point | Next.js 16 App Router (`src/app`), React 19, Tailwind 4, TypeScript 5.9 |
| Database | PostgreSQL via `pg`, 74 tables, plain SQL migrations in `db/migrations`, applied by `scripts/migrate.ts` |
| Data access | `withCtx()` runs each request as the restricted role `aiec_app` with tenant claims, so **row-level security** decides visibility; `withSystem()` is the trusted path |
| Authentication | Own phone + OTP sessions (`src/server/authcore.ts`); OTP is shown on screen in sandbox mode only |
| Roles / permissions | 13 roles, 57 permission codes, stored in the database and editable by the owner |
| Workspaces | `/admin` (AIEC staff), `/partner` (partner, supplier, service companies), `/customer`, `/tech` (offline technician app), public site |
| Business logic | All rules in `src/server/services/*`; pure logic in `src/lib/*`; pages and API routes contain no rules |
| Money | `numeric(14,2)` in the database, integer paise in code (`src/lib/commission.ts`), never floating point |
| Audit | Append-only `audit_logs` and `*_events` tables, guarded by a database trigger |
| Offline | Technician actions queue in IndexedDB with client UUIDs, deduplicated by `client_events` |
| Languages | Every screen in English, Hindi and Marathi; the compiler rejects a missing key |
| Tests | Vitest: 57 tests including RLS isolation, commission, refunds, webhook replay, offline replay |
| CI | GitHub Actions: typecheck, lint, i18n scan, tests on Postgres 16, production build |

## 3. What already works (keep as is)

1. **Lead CRM**: enquiry with consent, duplicate detection, SLA clocks, assignment by zone, state machine with mandatory reasons.
2. **Site survey**: scheduling, surveyor form with shaft width / depth, pit, overhead, stops, photos and GPS, review and rework.
3. **Partner registry**: company KYC (PAN, GSTIN), licences with expiry, insurance, verification reviews, grading, suspension, safety block, automatic expiry sweep.
4. **Partner matching**: hard eligibility gates with reasons (licence, insurance, zone, capacity, safety block) and a versioned, advisory weighted score.
5. **Partner quotations**: standard format, immutable submitted versions, revisions, side-by-side comparison, release to customer.
6. **Orders and projects**: partner acceptance, confirmation checklist, **5-project pilot capacity gate**, frozen payment milestones, start and handover gates tied to approved compliance documents, stop-work.
7. **Collections and commission**: evidence-backed collections, reconciliation, append-only commission ledger at the versioned policy rate (2% default), refunds and reversals, GST invoices, signed bank-reconciliation webhook with replay protection.
8. **Finance referral**: explicit consent, approved-fields-only handoff, withdrawal.
9. **Quality and safety**: compliance register, QC inspections, defects, corrective actions, incidents with escalation.
10. **Service**: warranty, AMC contracts, tickets, visits, disputes.
11. **Governance**: permissions map, audit log viewer, settings, reports, notifications, reminders job.

## 4. What can be reused for the marketplace

| Marketplace need | Reused component |
| --- | --- |
| "Create New Lift Project" | `leads` + `createLead()`: consent, SLA, duplicate check and survey pipeline come for free |
| Site survey request | `site_surveys` service; surveyed dimensions override customer-declared ones |
| Supplier portal | `companies` with `category = SUPPLIER / MANUFACTURER`, the `SUPPLIER` role, `catalogue.manage` permission, `/partner` workspace |
| Supplier KYC / GST | `companies.pan`, `companies.gstin` with format checks; verification-review workflow |
| Licensed partner portal | The whole `/partner` workspace (licences, team, capacity, bids = quotations, projects, collections) |
| Marketplace execution model | Existing partner quotation → order → project → collection → commission pipeline |
| Money arithmetic | `toPaise`, `fromPaise`, `percentOf` |
| Audit, notifications, files | `audit()`, `notify*()`, `saveFile()` (type and size checked, private) |
| Tenant isolation | `app.protect()` RLS helper and the `aiec_app` role |
| Translations, design tokens, UI primitives | `src/i18n`, `src/lib/themes.ts`, `src/components/ui` |

## 5. What needs modification

| Area | Change | Why |
| --- | --- | --- |
| Customer journey | Add a shopping flow (packages → customise → supplier options → cart → quotation) beside the existing enquiry flow | The current customer can only submit a requirement and wait for partner quotes |
| `products` table | Keep it (partner catalogue). Add a separate, approval-controlled supplier catalogue | The current table has no price, stock, warranty, approval state or technical attributes |
| Execution model | Record `AIEC_CONTRACT` or `MARKETPLACE` per project | Today only the marketplace model exists (customer pays partner, AIEC earns commission) |
| Admin dashboard | Add marketplace KPIs and an exception queue for approvals | New approvals (engineering, discount, supplier products, prices) need one place |
| Partner catalogue page | Supplier companies get product, price and stock management with approval status | Supplier approval and product approval must be separate |

## 6. What is missing

| Missing capability | Brief section |
| --- | --- |
| Ready-made packages (Basic / Standard / Premium / Luxury) with versions | 5 (Screen 4) |
| Customisation slots with standard / upgrade / add-on / replace options | 5 (Screen 5) |
| Approved-supplier product catalogue with prices, stock, warranty and delivery | 5 (Screen 6), 8 |
| Shopping cart / saved configurations | 5 (Screen 7) |
| Central pricing engine with versioned rules, margin protection and discount limits | 6 |
| Engineering compatibility engine (GREEN / YELLOW / RED), versioned rules | 7 |
| AIEC package quotation with immutable snapshot, versioning, validity and PDF download | 5 (Screen 8) |
| Engineering approval records for YELLOW configurations | 7 |
| Owner approval for discounts beyond the limit or margin below the floor | 6 |
| Execution model per project and the AIEC-contract order, invoice and partner payout chain | 10 |
| Event-driven automation log with idempotency, retry and status | 13 |
| Payment gateway (Razorpay) with server-side verification | 14 |
| PDF documents (the baseline audit lists PDF generation as "not built") | 5 |

## 7. What could break existing functionality — and how it is avoided

| Risk | Mitigation |
| --- | --- |
| Altering existing tables used by the 57 tests | New tables only; existing tables get **additive, nullable** columns at most |
| Changing the existing lead state machine | Shopping flow creates leads through the existing `createLead()`; no new lead states |
| RLS gaps on new tables | Every new table goes through `app.protect()`; integration tests check cross-tenant reads |
| Breaking the commission ledger | AIEC-contract money is kept out of `commission_ledger`; commission stays for the marketplace model only |
| Translation drift | New keys added to en, hi and mr together; the i18n scan stays at 0 missing |
| CSP violations from new pages | No inline scripts; client components only through the existing patterns |
| Fabricated prices reaching customers | No prices in migrations. Production starts with **no active pricing rules**, so the shop shows "price on request" until the owner approves rules and supplier prices. Demo prices exist only in the seed and are flagged `is_demo` |

## 8. Conclusion

The existing stack fully supports the marketplace requirements, so **no rewrite is justified**. The
work is additive: new tables, two pure engines, new services and new screens, wired into the
existing lead, survey, partner, order, project and commission pipeline.
