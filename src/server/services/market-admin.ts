// Owner view of the marketplace (brief section 12): KPIs and an exception queue, so the owner
// works on approvals and problems rather than routine activity.
import { requirePerm, type Ctx } from '../ctx';
import { withCtx, withSystem, type Rec } from '../db';
import { expireMarketQuotations } from './market-quotes';

export interface ExceptionItem { kind: string; count: number; href: string; severity: 'red' | 'amber' }

export async function getMarketOverview(ctx: Ctx) {
  requirePerm(ctx, 'market.view');
  return withCtx(ctx, async (tx) => {
    const k = await tx.one<Rec>(
      `select
         (select count(*) from market_project_specs) as projects,
         (select count(*) from configurations where status <> 'ARCHIVED' and created_at > now() - interval '30 days') as new_configurations,
         (select count(*) from market_quotations where status in ('ESTIMATE','PENDING_ENGINEERING','PENDING_OWNER_APPROVAL')) as quotations_pending,
         (select count(*) from market_quotations where status = 'ISSUED') as quotations_issued,
         (select count(*) from market_quotations where status = 'ACCEPTED') as accepted,
         (select coalesce(sum(v.selling_price), 0) from market_quotations q join market_quotation_versions v on v.id = q.accepted_version_id where q.status = 'ACCEPTED') as accepted_value,
         (select count(*) from market_quotations where status = 'ACCEPTED' and execution_model = 'AIEC_CONTRACT') as accepted_aiec,
         (select count(*) from market_quotations where status = 'ACCEPTED' and execution_model = 'MARKETPLACE') as accepted_marketplace,
         (select count(*) from companies where category in ('SUPPLIER','MANUFACTURER') and marketplace_status in ('APPROVED','PREFERRED')) as active_suppliers,
         (select count(*) from supplier_products where approval_status = 'APPROVED' and deleted_at is null) as approved_products,
         (select count(*) from package_versions where status = 'PUBLISHED') as published_packages`);
    const gross = await tx.maybeOne<Rec>(
      `select coalesce(sum(c.margin_amount), 0) as margin, coalesce(sum(v.selling_price), 0) as selling
         from market_quotations q join market_quotation_versions v on v.id = q.accepted_version_id join market_quotation_costs c on c.version_id = v.id
        where q.status = 'ACCEPTED'`);
    const e = await tx.one<Rec>(
      `select
         (select count(*) from market_quotations where status = 'PENDING_ENGINEERING') as engineering,
         (select count(*) from market_quotations where status = 'PENDING_OWNER_APPROVAL') as owner,
         (select count(*) from market_quotations where status = 'ESTIMATE') as estimates,
         (select count(*) from supplier_products where approval_status = 'SUBMITTED' and deleted_at is null) as products,
         (select count(*) from supplier_product_prices where status = 'SUBMITTED') as prices,
         (select count(*) from supplier_product_prices where status = 'SUBMITTED' and needs_review_reason is not null) as price_jumps,
         (select count(*) from companies where category in ('SUPPLIER','MANUFACTURER') and marketplace_status = 'PENDING') as suppliers,
         (select count(distinct q.id) from market_quotations q join market_quotation_versions v on v.id = q.current_version_id,
                 jsonb_array_elements(v.snapshot->'lines') l join supplier_products sp on sp.id = (l->>'productId')::uuid join companies c on c.id = sp.company_id
           where q.status in ('ESTIMATE','PENDING_ENGINEERING','PENDING_OWNER_APPROVAL','ISSUED')
             and (sp.approval_status <> 'APPROVED' or sp.deleted_at is not null or c.marketplace_status not in ('APPROVED','PREFERRED') or c.status <> 'ACTIVE')) as quotes_ineligible,
         (select count(*) from market_quotations q join market_quotation_versions v on v.id = q.current_version_id
           where q.status in ('ESTIMATE','PENDING_ENGINEERING','PENDING_OWNER_APPROVAL','ISSUED')
             and v.valid_until between (now() at time zone 'Asia/Kolkata')::date and (now() at time zone 'Asia/Kolkata')::date + 3) as expiring,
         (select count(*) from automation_events where status = 'FAILED') as failed_events,
         (select count(*) from pricing_rule_versions where status = 'ACTIVE') as pricing_active,
         (select count(*) from compatibility_rule_versions where status = 'ACTIVE') as compat_active,
         (select count(*) from companies c where c.category = 'ELEVATOR_COMPANY' and c.status = 'EXPIRED') as partners_expired,
         (select count(*) from supplier_purchase_orders po where po.status in ('ISSUED','ACKNOWLEDGED')
             and po.expected_delivery < (now() at time zone 'Asia/Kolkata')::date) as supplier_delays,
         (select count(*) from customer_invoices i where i.status in ('ISSUED','PARTLY_PAID')
             and i.due_date < (now() at time zone 'Asia/Kolkata')::date) as payment_delays`);
    const n = (v: unknown) => Number(v ?? 0);
    const items: ExceptionItem[] = [
      { kind: 'pricingRulesMissing', count: n(e.pricing_active) ? 0 : 1, href: '/admin/marketplace/rules', severity: 'red' },
      { kind: 'compatRulesMissing', count: n(e.compat_active) ? 0 : 1, href: '/admin/marketplace/rules', severity: 'red' },
      { kind: 'quotesIneligible', count: n(e.quotes_ineligible), href: '/admin/marketplace/quotations', severity: 'red' },
      { kind: 'failedEvents', count: n(e.failed_events), href: '/admin/audit', severity: 'red' },
      { kind: 'partnersExpired', count: n(e.partners_expired), href: '/admin/partners?status=EXPIRED', severity: 'red' },
      { kind: 'paymentDelays', count: n(e.payment_delays), href: '/admin/orders', severity: 'red' },
      { kind: 'supplierDelays', count: n(e.supplier_delays), href: '/admin/orders', severity: 'amber' },
      { kind: 'engineering', count: n(e.engineering), href: '/admin/marketplace/quotations?status=PENDING_ENGINEERING', severity: 'amber' },
      { kind: 'owner', count: n(e.owner), href: '/admin/marketplace/quotations?status=PENDING_OWNER_APPROVAL', severity: 'amber' },
      { kind: 'priceJumps', count: n(e.price_jumps), href: '/admin/marketplace/catalogue', severity: 'amber' },
      { kind: 'prices', count: n(e.prices), href: '/admin/marketplace/catalogue', severity: 'amber' },
      { kind: 'products', count: n(e.products), href: '/admin/marketplace/catalogue', severity: 'amber' },
      { kind: 'suppliers', count: n(e.suppliers), href: '/admin/marketplace/catalogue', severity: 'amber' },
      { kind: 'expiring', count: n(e.expiring), href: '/admin/marketplace/quotations', severity: 'amber' },
      { kind: 'estimates', count: n(e.estimates), href: '/admin/marketplace/quotations?status=ESTIMATE', severity: 'amber' },
    ];
    return { kpis: { ...k, gross_margin: gross?.margin ?? '0', margin_base: gross?.selling ?? '0' } as Rec, exceptions: items.filter((i) => i.count > 0) };
  });
}

/** Called by the housekeeping job. */
export async function runMarketSweep(): Promise<{ marketQuotationsExpired: number }> {
  return withSystem(async (tx) => ({ marketQuotationsExpired: await expireMarketQuotations(tx) }));
}
