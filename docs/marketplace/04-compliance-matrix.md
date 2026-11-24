# Compliance matrix by project type (draft for legal verification)

**This is not legal advice and claims no certification.** It records what the platform enforces and
what AIEC must verify against the official texts. Sources checked on 24 November 2026:

- The **Maharashtra Lifts, Escalators and Moving Walks Act, 2017** came into force on **1 November 2026**.
- The **Maharashtra Lifts, Escalators and Moving Walks Rules, 2026** were notified by the Energy Department (notification CEI-2025/C.R.55/Energy-1, 28 October 2026) under Section 37 of the Act and also apply from 1 November 2026.
- Public summaries report monthly inspection and servicing by licensed or approved contractors with maintenance records, annual audits, contractor eligibility, sealing of unsafe installations and a rule on children under 12.

These points come from secondary sources (legal-news and compliance portals, plus a gazette copy on
a third-party site). **Verify every item against the official Maharashtra Government Gazette before
relying on rule numbers, forms or deadlines.**

| Requirement area | New building – passenger | Existing building – retrofit | Home lift | Goods / hospital | How the platform enforces it | To verify |
| --- | --- | --- | --- | --- | --- | --- |
| Licensed lift contractor executes the work | Required | Required | Required | Required | Partners need a verified, unexpired `LIFT_CONTRACTOR` licence; expiry sweep suspends them (existing) | Licence classes and scope under the Rules, 2026 |
| Erection permission before work | Required | Required | Verify applicability | Required | `PROJECT_START` compliance gate blocks project start (existing) | Form, authority, timelines |
| Inspection and working licence before use | Required | Required | Verify | Required | `HANDOVER` gate blocks handover (existing); quotations state acceptance is not a permission | Inspection procedure, fees |
| Monthly maintenance by licensed / approved contractor, records kept | Required after handover | Required | Verify | Required | AMC contracts and visit records (existing); reminders job | Frequency and record format |
| Annual audit | Reported | Reported | Verify | Reported | Compliance document type `SAFETY_AUDIT` (existing) | Who audits and when |
| Mandatory safety components | Yes | Yes | Yes | Yes | Safety slots are mandatory and locked; missing safety category = RED; supplier must give technical data | Component list per BIS / IS 14665 |
| Accessibility (door width, cabin size) | When requested | When requested | When requested | Hospital: verify | `DOOR_NOT_ACCESSIBLE` = RED below the configured width (draft 900 mm) | NBC 2016 / applicable standard values |
| Pit / overhead minimums | Yes | Often reduced → engineer | Low-pit products | Yes | Reduced values = YELLOW (engineer must decide); below reduced minimum = RED | Values per standard and product certificate |
| Engineering sign-off | Every final quotation | Every final quotation | Every final quotation | Every final quotation | `ENGINEER` decision recorded permanently with name and note; YELLOW items acknowledged one by one | Who counts as an authorised engineer |
| Consumer disclosures (estimate vs final, exclusions, validity) | Yes | Yes | Yes | Yes | Price basis on screen and PDF; exclusions, milestones, validity; acceptance needs explicit terms consent | Consumer Protection (E-Commerce) Rules wording |
| GST on supply and installation | Yes | Yes | Yes | Yes | Configurable rate in pricing rules; shown as "estimated" | Classification (supply vs works contract) with the CA |
| Data protection (photos, contact data) | Yes | Yes | Yes | Yes | Private file storage, RLS, consent at project creation, access logs (existing) | DPDP Act 2023 notices and retention |
| Finance referral consent | If used | If used | If used | If used | Existing consent-based referral, unchanged | RBI digital lending role of AIEC |
| Children under 12 rule | Building owner notice | Owner notice | Owner notice | — | Not enforced by software; include in handover pack | Exact wording and signage duty |
