# AIEC Lift Marketplace — Architecture and Gap Plan (Phase 2)

## Decision: extend, do not rewrite

The audit (`01-existing-system-audit.md`) shows the current stack (Next.js 16, PostgreSQL with
row-level security, services layer, integer-paise money, append-only audit, en/hi/mr) supports
every marketplace requirement. The marketplace is therefore built **inside the same application**,
as new tables, engines, services and screens connected to the existing pipeline.

## The connected flow

```
Customer ─▶ Lift project (= existing lead: consent, SLA, duplicate check, survey)
          └▶ Building + lift requirements (market_project_specs)
               └▶ Package (published package_versions) ─▶ customise slots with approved options
                    └▶ Cart (configurations + configuration_items)
                         ├─ Pricing engine  (src/lib/pricing.ts, active pricing_rule_versions)
                         └─ Compatibility engine (src/lib/compatibility.ts, active compatibility_rule_versions)
                              └▶ Quotation (market_quotations + immutable market_quotation_versions snapshot)
                                   ├─ ESTIMATE (declared dimensions)      → request site survey (existing survey flow)
                                   ├─ FINAL (survey-reviewed dimensions)  → engineering approval (always)
                                   ├─ pricing exception (discount / margin) → owner approval
                                   └─ ISSUED → customer accepts and chooses execution model
                                        ├─ MARKETPLACE   → existing partner matching → order → project → collections → milestone commission
                                        └─ AIEC_CONTRACT → AIEC contract order, AIEC invoices, partner payouts (next phase)
```

## Key rules and where they are enforced

| Rule | Enforcement |
| --- | --- |
| Customers only see AIEC-approved suppliers and products | Product is eligible only if the supplier's marketplace status is `APPROVED`/`PREFERRED`, the product is `APPROVED`, not deleted, and has a current `APPROVED` price. Checked in the catalogue query and again by the compatibility engine (`PRODUCT_NOT_ELIGIBLE` = RED). |
| Supplier approval and product approval are separate | `companies.marketplace_status` vs `supplier_products.approval_status`, each with its own approval action and audit entry. |
| Customers cannot remove safety components | Package slots flagged `is_safety_critical` are mandatory and not customer-editable; the service rejects any change; the engine raises RED if a required safety category is missing. |
| No hard-coded selling prices | Migrations contain no prices. With no active pricing rule version the shop shows "price on request". Demo prices exist only in `scripts/seed.ts` and are flagged `is_demo`. |
| Margin data is not exposed to customers | Pricing rules and supplier costs have no customer read policy; the engine is fed through `SECURITY DEFINER` functions and only customer-facing prices leave the server. |
| A supplier price change never alters an approved quotation | Quotations store a full snapshot (unit costs, price ids, rule versions, totals) in an immutable version row (database trigger). New prices are new rows. |
| RED cannot proceed | A RED configuration cannot request a quotation, cannot be approved by an engineer and cannot be accepted. |
| YELLOW needs a documented engineer decision | Every FINAL quotation needs an engineering approval record from a user with `engineering.approve`; YELLOW findings must be acknowledged one by one with a note. |
| Discount and margin exceptions need the owner | `pricing.approve` permission; approval record is append-only. |
| Estimated vs final | `price_basis = ESTIMATED` until a reviewed site survey supplies the dimensions; only FINAL, ISSUED, unexpired versions can be accepted. |
| Duplicate requests do nothing twice | Every automated step writes `automation_events` with a unique idempotency key in the same transaction. |
| Execution model per project | `leads.execution_model` set at acceptance; both models keep separate contracts, money and liability records. |

## Phases and status

| Phase | Scope | Status in this delivery |
| --- | --- | --- |
| 1 | Existing repository audit | Done |
| 2 | Architecture and gap analysis | Done (this file) |
| 3 | Database and migration design | Done: `db/migrations/0005_marketplace.sql` |
| 4 | Package catalogue | Done |
| 5 | Customer shopping interface | Done |
| 6 | Customisation and smart cart | Done |
| 7 | Pricing and compatibility engines | Done, unit-tested |
| 8 | Quotation system (versions, approvals, PDF) | Done |
| 9 | Supplier portal (products, prices, stock, approval) | Core done; RFQs, dispatch and supplier ledger pending |
| 10 | Licensed partner portal | Existing portal reused for the marketplace model; AIEC-contract partner engagement pending |
| 11 | Admin dashboard | Marketplace approvals and exception queue done; full KPI set pending |
| 12 | Payments and commission | Existing commission engine kept; Razorpay integration pending (needs merchant onboarding) |
| 13 | Workflow automation | Event log with idempotency done; retry worker pending |
| 14 | Security and compliance | RLS on every new table, compliance matrix drafted; full review pending |
| 15 | Testing and production deployment | Automated tests extended; deployment steps unchanged |

See `03-delivery-report.md` for files, test results and limitations of this delivery.
