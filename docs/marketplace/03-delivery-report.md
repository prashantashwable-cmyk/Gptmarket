# AIEC Lift Marketplace — Delivery Report (this release)

Date: 24 November 2026. Baseline: `AIEC-PLATFORM-1 @ 5f077d5` (commit `6e14617` in this repository).
Everything below was built **additively**; no existing feature was removed or rewritten.

## 1. Verification actually run

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 problems |
| `npx tsx scripts/i18n-scan.ts` | 1,295 keys, 0 missing (English, Hindi, Marathi) |
| `npm test` (real PostgreSQL 16) | **100 / 100 passed**: 57 original + 20 engine unit tests + 23 marketplace integration tests |
| `npx next build` | Production build succeeds |
| `node scripts/smoke.mjs` | Every new page returns 200 with no console errors, horizontal overflow or untranslated keys, for Customer (en/hi/mr, desktop and mobile), Super Admin (en/mr), Engineer (hi), Supplier and Partner Admin (en) |
| `node scripts/e2e-shop.mjs` | Real browser: create project → choose package → upgrade an option (price updates) → request quotation → download PDF. Passed, 0 console errors |

## 2. Modules delivered

### Database (Phase 3) — `db/migrations/0005_marketplace.sql`
New tables: `component_categories`, `supplier_products`, `supplier_product_prices`, `lift_packages`,
`package_versions`, `package_slots`, `package_slot_options`, `pricing_rule_versions`,
`compatibility_rule_versions`, `market_project_specs`, `market_site_photos`, `configurations`,
`configuration_items`, `market_quotations`, `market_quotation_versions`, `market_quotation_costs`,
`market_quotation_approvals`, `automation_events`. Additive columns: `companies.marketplace_status`
(+ reason, reviewer), `leads.execution_model`, file kind `SITE_PHOTO`.

Database-level guards (they hold even if application code has a bug):

- Quotation versions, cost build-ups and approvals are immutable (trigger).
- Supplier price amounts can never change; history rows are never deleted.
- Published package versions and their components/options are frozen.
- Active/retired rule parameters are frozen; only one active version of each rule set.
- One standard option per package component; safety components can never be optional or customer-editable (CHECK).
- `selling_before_discount = Σ charges`, `selling = before − discount`, `total = selling + GST` (CHECK).
- Row-level security on every new table. Customers cannot read supplier costs, pricing rules or the internal cost build-up, even with a direct query (tested).
- Idempotency: `automation_events.idempotency_key` is unique.

### Pricing engine (Phase 7) — `src/lib/pricing.ts`
Integer paise, no floating point. Material (per unit / per stop / per metre of travel) + installation
(base + per stop) + zone-specific transport + site work → overhead → margin → discount → GST.
Overhead and margin are applied per line so customer-facing lines add up exactly. Flags
`DISCOUNT_ABOVE_LIMIT` and `MARGIN_BELOW_FLOOR` for owner approval. Rules (including payment
milestones and quotation validity) are versioned in `pricing_rule_versions`.

### Compatibility engine (Phase 7) — `src/lib/compatibility.ts`
GREEN / YELLOW / RED across: missing or undeclared measurements, rated load vs passengers, package
eligibility, product/supplier eligibility, mandatory and safety components, motor load/speed/power vs
supply, controller stops/speed/drive, cabin vs shaft width/depth and load, door widths (incl.
accessibility), pit/overhead by speed band (reduced = YELLOW, below reduced minimum = RED), safety
component ratings. Parameters are versioned in `compatibility_rule_versions`.

### Services
| File | Responsibility |
| --- | --- |
| `src/server/services/catalogue.ts` | Supplier products, prices (with >25% change flag), stock; AIEC approval of supplier, product and price separately |
| `src/server/services/packages.ts` | Package drafts, components, options, publish/retire |
| `src/server/services/rules.ts` | Pricing and engineering rule drafts and activation |
| `src/server/services/market-engine.ts` | Loads spec (survey overrides declared), costs and rules; runs both engines; customer-safe projection |
| `src/server/services/shop.ts` | Customer project creation (reuses the CRM lead), specification, catalogue, cart, comparison |
| `src/server/services/market-quotes.ts` | Immutable quotation versions, engineering and owner decisions, acceptance with execution model, expiry |
| `src/server/services/market-admin.ts` | Marketplace KPIs and exception queue; housekeeping sweep |
| `src/server/services/automation.ts` | Idempotent event log |
| `src/server/services/quotation-pdf.ts` + `src/app/api/market/quotations/[id]/pdf` | Downloadable PDF from the snapshot |

### Screens (Phases 4–6, 8, 9, 11), all in English, Hindi and Marathi
- Customer: `/customer/shop` (dashboard), `/customer/shop/new` (building + requirements + photos),
  `/customer/shop/projects/[id]`, `…/packages` (catalogue), `…/compare`, `/customer/shop/cart/[id]`
  (customisation, supplier options, smart cart, sticky mobile total), `/customer/shop/quotations/[id]`
  (quotation, PDF, accept with execution model, decline). A banner on `/customer` links to the shop.
- Admin: `/admin/marketplace` (KPIs + exception queue), `…/catalogue`, `…/packages`, `…/packages/[id]`
  (editor), `…/rules`, `…/quotations`, `…/quotations/[id]` (internal costs, engineering decision with
  per-finding acknowledgement, owner approval, re-issue with discount, version PDFs, automation log).
- Supplier: `/partner/marketplace` (products with technical data per category, prices, stock, history).

### New role and permissions
Role `ENGINEER` (authorised lift engineer). Permissions: `market.view`, `market.quote`,
`catalogue.approve`, `package.manage`, `pricing.manage`, `pricing.approve` (owner only by default),
`engineering.approve`. Super Admin holds all; Operations Manager holds all except `pricing.approve`
and `engineering.approve`.

## 3. Tests added
`tests/marketplace.unit.test.ts` (20) and `tests/marketplace.integration.test.ts` (23) cover brief
section 17 items 2–13, 18, 19 and the extra cases: project creation, package selection,
customisation and locked safety components, cart arithmetic, supplier options, compatibility
(GREEN/YELLOW/RED), quotation generation and versioning, **price-change protection**, **discount
approval**, **supplier suspension**, unauthorised access (customer, supplier, ops vs owner,
non-engineer), audit logging, **concurrent duplicate requests**, incorrect supplier pricing (jump
flag, zero price), incompatible combinations, **expired quotation**, database immutability.
Payment verification, refunds, commission, offline sync and partner licence expiry remain covered
by the original suite.

## 4. Remaining limitations (honest list)
1. **AIEC-contract order chain is not built yet.** Acceptance records the execution model and freezes the price; for `MARKETPLACE` the existing partner matching → order → project → collection → commission pipeline continues. For `AIEC_CONTRACT`, the AIEC order, AIEC invoices, partner engagement and partner payouts are the next phase (brief sections 10, 12).
2. **Razorpay is not integrated.** No merchant account exists. The existing commission engine and signed bank webhook are unchanged. The integration needs merchant onboarding first.
3. **Supplier RFQs, dispatch updates, supplier ledger and performance score** (brief section 8) are not built.
4. **Licensed partner bidding for AIEC-contract projects** (brief section 9) uses the existing invitation/quotation flow only.
5. **Automation retry worker:** events are recorded with status, attempts and idempotency. A background retry of `FAILED` events is not implemented; failures appear in the exception queue.
6. **PDF is English-only.** The standard PDF fonts cannot draw ₹ or Devanagari, so it uses "Rs.". The on-screen quotation is trilingual. A Devanagari PDF needs an embedded Unicode font and a text-shaping engine.
7. **Rate limiting** exists for OTP only (unchanged from baseline).
8. **Engineering defaults are a draft.** `DEFAULT_COMPAT_PARAMS` (68 kg/person, clearances, pit/overhead bands, 900 mm accessible door, 3.7 kW three-phase threshold) must be confirmed by AIEC's authorised engineer before activation.

## 5. Configuration required before production
1. Owner creates and activates a **pricing rule version** (`/admin/marketplace/rules`). Until then customers see "price on request".
2. An authorised engineer reviews and activates the **compatibility rules** (version 1 ships as a draft).
3. Approve real **suppliers** (after KYC), their **products** and **prices**, then build and publish the four **packages**.
4. Assign the `ENGINEER` role to the authorised engineer (`/admin/users`).
5. Confirm the GST classification and rate with AIEC's CA (18% is a configurable value, not advice).
6. Keep scheduling `POST /api/jobs/housekeeping` daily; it now also expires package quotations.
7. Do **not** run `scripts/seed.ts` in production (all marketplace demo data is fictional and flagged `is_demo`).
