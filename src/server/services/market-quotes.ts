// AIEC package quotations (brief sections 5 screen 8, 6, 7): immutable versioned snapshots,
// engineering approval of every final quotation, owner approval of pricing exceptions, and
// customer acceptance with the execution model chosen for the project.
import { z } from 'zod';
import { EXECUTION_MODEL, type MarketQuotationStatus } from '@/lib/enums';
import { AppError } from '@/lib/errors';
import { isoDateIST } from '@/lib/format';
import { zEnum, zOptText, zText, zUuid } from '@/lib/validation';
import { audit, notifyCustomer, notifyPermission } from '../audit';
import { requireCustomer, requirePerm, type Ctx } from '../ctx';
import { withCtx, withSystem, type Rec, type Tx } from '../db';
import { emitEvent } from './automation';
import { customerView, evaluate } from './market-engine';

const OPEN: MarketQuotationStatus[] = ['ESTIMATE', 'PENDING_ENGINEERING', 'PENDING_OWNER_APPROVAL', 'ISSUED'];

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function selectionsOf(tx: Tx, configId: string): Promise<Map<string, string | null>> {
  const items = await tx.query<{ slot_id: string; product_id: string | null }>('select slot_id, product_id from configuration_items where configuration_id = $1', [configId]);
  return new Map(items.map((i) => [i.slot_id, i.product_id]));
}

/**
 * Creates the next immutable version of the configuration's quotation (trusted path; callers check access).
 * Price basis is FINAL only when the dimensions come from a reviewed AIEC site survey.
 */
export async function buildVersion(
  tx: Tx, actor: Ctx, configId: string, opts: { discountPercent?: string; discountReason?: string | null } = {},
): Promise<{ quotationId: string; versionId: string; status: MarketQuotationStatus }> {
  const config = await tx.one<Rec>('select * from configurations where id = $1 for update', [configId]);
  if (config.status === 'ARCHIVED') throw new AppError('INVALID_TRANSITION');
  const e = await evaluate(tx, { leadId: config.lead_id, packageVersionId: config.package_version_id, selections: await selectionsOf(tx, configId), discountPercent: opts.discountPercent });
  if (e.compatStatus !== 'OK' || !e.compat || !e.rules.compatibility) throw new AppError('COMPATIBILITY_NOT_CONFIGURED');
  if (e.pricingStatus !== 'OK' || !e.pricing || !e.rules.pricing) throw new AppError(`PRICING_${e.pricingStatus}`);
  if (e.compat.status === 'RED') throw new AppError('CONFIG_INCOMPATIBLE');
  const view = customerView(e);
  const finalBasis = e.spec.spec.source === 'SURVEYED';
  const needsOwner = e.pricing.exceptions.length > 0;
  const status: MarketQuotationStatus = finalBasis ? 'PENDING_ENGINEERING' : 'ESTIMATE';

  const lead = await tx.one<Rec>(
    `select l.lead_number, l.project_name, l.address, l.building_type, c.name, c.phone from leads l join customers c on c.id = l.customer_id where l.id = $1`, [config.lead_id]);
  let q = await tx.maybeOne<Rec>('select * from market_quotations where configuration_id = $1 for update', [configId]);
  if (q && q.status === 'ACCEPTED') throw new AppError('QUOTATION_ACCEPTED');
  if (!q) {
    q = await tx.one<Rec>('insert into market_quotations (configuration_id, lead_id, customer_id) values ($1,$2,$3) returning *', [configId, config.lead_id, config.customer_id]);
  }
  const versionNo = (await tx.one<{ n: number }>('select coalesce(max(version_no), 0) + 1 as n from market_quotation_versions where quotation_id = $1', [q.id])).n;
  const lines = e.pricing.lines.map((l) => {
    const slot = e.slots.find((s) => s.slotId === l.slotId)!;
    const opt = slot.options.find((o) => o.productId === l.productId)!;
    return {
      slotId: l.slotId, category: l.category, kind: l.kind, isSafetyCritical: slot.isSafetyCritical, isMandatory: slot.isMandatory,
      productId: l.productId, productName: opt.name, brand: opt.brand, model: opt.model, supplierId: opt.supplierId, supplierName: opt.supplierName,
      warrantyMonths: opt.warrantyMonths, deliveryDays: opt.deliveryDays, quantity: l.quantity, customerPrice: l.customerPrice, upgradeCharge: l.upgradeCharge,
    };
  });
  const snapshot = {
    generatedAt: new Date().toISOString(),
    customer: { name: lead.name, phone: lead.phone },
    project: { leadNumber: lead.lead_number, projectName: lead.project_name, address: lead.address, zoneCode: e.spec.zoneCode, buildingType: lead.building_type },
    spec: e.spec.spec,
    package: view.packageVersion,
    lines,
    charges: e.pricing.charges,
    compat: e.compat,
    paymentMilestones: e.rules.pricing.params.paymentMilestones,
    rules: { pricingVersion: e.rules.pricing.versionNo, compatibilityVersion: e.rules.compatibility.versionNo },
  };
  const validUntil = addDays(isoDateIST(), e.rules.pricing.params.quoteValidityDays);
  const p = e.pricing;
  const v = await tx.one<{ id: string }>(
    `insert into market_quotation_versions (quotation_id, version_no, price_basis, spec_source, compat_status, pricing_rule_version_id, compatibility_rule_version_id,
            charge_materials, charge_installation, charge_transport, charge_site_work, selling_before_discount, discount_percent, discount_amount, selling_price,
            gst_percent, gst_amount, total_payable, needs_owner_approval, snapshot, valid_until, discount_reason, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) returning id`,
    [q.id, versionNo, finalBasis ? 'FINAL' : 'ESTIMATED', e.spec.spec.source, e.compat.status, e.rules.pricing.id, e.rules.compatibility.id,
      p.charges.materials, p.charges.installation, p.charges.transport, p.charges.siteWork, p.sellingBeforeDiscount, p.discountPercent, p.discountAmount,
      p.sellingPrice, p.gstPercent, p.gstAmount, p.totalPayable, needsOwner, JSON.stringify(snapshot), validUntil, opts.discountReason ?? null, actor.userId]);
  await tx.exec(
    `insert into market_quotation_costs (version_id, material_cost, installation_cost, transport_cost, site_work_cost, project_cost, overhead_amount,
            margin_amount, margin_percent, exceptions, cost_lines) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [v.id, p.materialCost, p.installationCost, p.transportCost, p.siteWorkCost, p.projectCost, p.overheadAmount, p.marginAmount, p.marginPercent,
      p.exceptions, JSON.stringify(p.lines.map((l) => ({ slotId: l.slotId, productId: l.productId, priceId: l.priceId, unitCost: l.unitCost, quantity: l.quantity, lineCost: l.lineCost })))]);
  await tx.exec('update market_quotations set current_version_id = $2, status = $3, status_reason = null, updated_at = now() where id = $1', [q.id, v.id, status]);
  await tx.exec(`update configurations set status = 'QUOTED', updated_at = now() where id = $1`, [configId]);
  await audit(tx, actor, 'market_quotation.version', 'market_quotation', q.id, {
    version: versionNo, basis: finalBasis ? 'FINAL' : 'ESTIMATED', compat: e.compat.status, total: p.totalPayable, discount: p.discountPercent, exceptions: p.exceptions,
  });
  return { quotationId: q.id, versionId: v.id, status };
}

// ───────────── customer ─────────────
export const requestQuotationSchema = z.object({ configId: zUuid, requestId: zUuid });
/** Customer requests a quotation for a cart. Re-submitting the same request id does nothing twice. */
export async function requestQuotation(ctx: Ctx, input: z.infer<typeof requestQuotationSchema>): Promise<{ quotationId: string; duplicate: boolean }> {
  const customerId = requireCustomer(ctx);
  await withCtx(ctx, (tx) => tx.one('select id from configurations where id = $1 and customer_id = $2', [input.configId, customerId]));
  return withSystem(async (tx) => {
    if (!(await emitEvent(tx, ctx, 'QUOTATION_REQUESTED', `quote-request:${input.requestId}`, { type: 'configuration', id: input.configId }))) {
      const existing = await tx.one<{ id: string }>('select id from market_quotations where configuration_id = $1', [input.configId]);
      return { quotationId: existing.id, duplicate: true };
    }
    const r = await buildVersion(tx, ctx, input.configId);
    const q = await tx.one<Rec>('select quotation_number from market_quotations where id = $1', [r.quotationId]);
    await notifyPermission(tx, r.status === 'ESTIMATE' ? 'market.quote' : 'engineering.approve',
      r.status === 'ESTIMATE' ? 'MARKET_QUOTE_REQUESTED' : 'ENGINEERING_REVIEW_DUE', { number: q.quotation_number }, `/admin/marketplace/quotations/${r.quotationId}`);
    if (r.status === 'ESTIMATE') {
      // Package selected and quotation requested on declared dimensions → AIEC must survey the site.
      const lead = await tx.one<Rec>('select id, lead_number, status from leads where id = (select lead_id from configurations where id = $1)', [input.configId]);
      if (await emitEvent(tx, ctx, 'SURVEY_REQUESTED', `survey-request:${lead.id}`, { type: 'lead', id: lead.id })) {
        await notifyPermission(tx, 'survey.schedule', 'SURVEY_REQUESTED', { number: lead.lead_number }, `/admin/leads/${lead.id}`);
      }
    }
    return { quotationId: r.quotationId, duplicate: false };
  });
}

export const respondSchema = z.object({
  id: zUuid, decision: zEnum(['ACCEPT', 'DECLINE'] as const), executionModel: zEnum(EXECUTION_MODEL).optional(),
  termsAccepted: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()), note: zOptText(500),
});
/** Accepting needs an ISSUED, FINAL, unexpired current version whose products and suppliers are still approved. */
export async function respondQuotation(ctx: Ctx, input: z.infer<typeof respondSchema>): Promise<void> {
  const customerId = requireCustomer(ctx);
  await withCtx(ctx, (tx) => tx.one('select id from market_quotations where id = $1 and customer_id = $2', [input.id, customerId]));
  await withSystem(async (tx) => {
    const q = await tx.one<Rec>(
      `select q.*, v.price_basis, v.valid_until, v.snapshot, v.version_no, v.total_payable from market_quotations q
         join market_quotation_versions v on v.id = q.current_version_id where q.id = $1 for update of q`, [input.id]);
    if (input.decision === 'DECLINE') {
      if (!OPEN.includes(q.status)) throw new AppError('INVALID_TRANSITION');
      await tx.exec(`update market_quotations set status = 'DECLINED', status_reason = $2, updated_at = now() where id = $1`, [q.id, input.note ?? null]);
      await audit(tx, ctx, 'market_quotation.decline', 'market_quotation', q.id, { note: input.note ?? null });
      return;
    }
    if (q.status !== 'ISSUED' || q.price_basis !== 'FINAL') throw new AppError('QUOTATION_NOT_ISSUED');
    if (q.valid_until < isoDateIST()) throw new AppError('QUOTATION_EXPIRED');
    if (!input.executionModel) throw new AppError('VALIDATION', undefined, { executionModel: 'REQUIRED' });
    if (!input.termsAccepted) throw new AppError('VALIDATION', undefined, { termsAccepted: 'CONSENT_REQUIRED' });
    const productIds = (q.snapshot.lines as Array<{ productId: string }>).map((l) => l.productId);
    const stillOk = (await tx.one<{ n: number }>(
      `select count(*) as n from supplier_products sp join companies c on c.id = sp.company_id
        where sp.id = any($1) and sp.approval_status = 'APPROVED' and sp.deleted_at is null and c.status = 'ACTIVE' and c.marketplace_status in ('APPROVED','PREFERRED')`,
      [productIds])).n;
    if (stillOk !== new Set(productIds).size) throw new AppError('SUPPLIER_NO_LONGER_APPROVED');
    if (!(await emitEvent(tx, ctx, 'QUOTATION_ACCEPTED', `quote-accept:${q.id}`, { type: 'market_quotation', id: q.id }, { version: q.version_no, model: input.executionModel }))) return;
    await tx.exec(
      `update market_quotations set status = 'ACCEPTED', accepted_version_id = current_version_id, accepted_at = now(), accepted_by = $2, execution_model = $3, updated_at = now() where id = $1`,
      [q.id, ctx.userId, input.executionModel]);
    await tx.exec('update leads set execution_model = $2, updated_at = now() where id = $1', [q.lead_id, input.executionModel]);
    await tx.exec(`update market_quotations set status = 'CANCELLED', status_reason = 'Another configuration was accepted', updated_at = now()
                    where lead_id = $1 and id <> $2 and status = any($3)`, [q.lead_id, q.id, OPEN]);
    await audit(tx, ctx, 'market_quotation.accept', 'market_quotation', q.id, { version: q.version_no, total: q.total_payable, model: input.executionModel });
    await notifyPermission(tx, 'market.quote', 'MARKET_QUOTE_ACCEPTED', { number: q.quotation_number, model: input.executionModel }, `/admin/marketplace/quotations/${q.id}`);
  });
}

// ───────────── AIEC staff ─────────────
export const issueSchema = z.object({ id: zUuid, discountPercent: z.string().regex(/^\d{1,2}(\.\d{1,4})?$/, 'INVALID').default('0'), discountReason: zOptText(500) });
/** Re-prices the configuration at today's approved prices and rules as a new version (optionally with a discount). */
export async function issueNewVersion(ctx: Ctx, input: z.infer<typeof issueSchema>): Promise<string> {
  requirePerm(ctx, 'market.quote');
  if (Number(input.discountPercent) > 0 && !input.discountReason) throw new AppError('VALIDATION', undefined, { discountReason: 'REQUIRED' });
  const q = await withCtx(ctx, (tx) => tx.one<Rec>('select id, configuration_id, status, quotation_number from market_quotations where id = $1', [input.id]));
  if (!['ESTIMATE', 'PENDING_ENGINEERING', 'PENDING_OWNER_APPROVAL', 'ISSUED', 'REJECTED', 'EXPIRED', 'DECLINED'].includes(q.status)) throw new AppError('INVALID_TRANSITION');
  return withSystem(async (tx) => {
    const r = await buildVersion(tx, ctx, q.configuration_id, { discountPercent: input.discountPercent, discountReason: input.discountReason ?? null });
    if (r.status === 'PENDING_ENGINEERING') {
      await notifyPermission(tx, 'engineering.approve', 'ENGINEERING_REVIEW_DUE', { number: q.quotation_number }, `/admin/marketplace/quotations/${q.id}`);
    }
    return r.versionId;
  });
}

export const engineeringSchema = z.object({
  versionId: zUuid, decision: zEnum(['APPROVED', 'REJECTED'] as const), note: zText(2000), acknowledged: z.array(z.string()).default([]),
});
/** The authorised engineer's documented decision. Every YELLOW finding must be acknowledged explicitly. */
export async function engineeringDecision(ctx: Ctx, input: z.infer<typeof engineeringSchema>): Promise<void> {
  requirePerm(ctx, 'engineering.approve');
  await withCtx(ctx, async (tx) => {
    const v = await tx.one<Rec>(
      `select v.*, q.status as q_status, q.current_version_id, q.quotation_number, q.customer_id, q.lead_id from market_quotation_versions v
         join market_quotations q on q.id = v.quotation_id where v.id = $1 for update of q`, [input.versionId]);
    if (v.current_version_id !== v.id || v.q_status !== 'PENDING_ENGINEERING' || v.price_basis !== 'FINAL') throw new AppError('INVALID_TRANSITION');
    if (v.compat_status === 'RED') throw new AppError('CONFIG_INCOMPATIBLE');
    const yellow = [...new Set((v.snapshot.compat.findings as Array<{ code: string; level: string }>).filter((f) => f.level === 'YELLOW').map((f) => f.code))];
    if (input.decision === 'APPROVED' && yellow.some((code) => !input.acknowledged.includes(code))) throw new AppError('FINDINGS_NOT_ACKNOWLEDGED');
    await tx.exec(
      `insert into market_quotation_approvals (quotation_id, version_id, kind, decision, acknowledged_findings, note, decided_by) values ($1,$2,'ENGINEERING',$3,$4,$5,$6)`,
      [v.quotation_id, v.id, input.decision, input.decision === 'APPROVED' ? yellow : [], input.note, ctx.userId]);
    const next: MarketQuotationStatus = input.decision === 'REJECTED' ? 'REJECTED' : v.needs_owner_approval ? 'PENDING_OWNER_APPROVAL' : 'ISSUED';
    await tx.exec('update market_quotations set status = $2, status_reason = $3, updated_at = now() where id = $1', [v.quotation_id, next, input.decision === 'REJECTED' ? input.note : null]);
    await audit(tx, ctx, 'market_quotation.engineering', 'market_quotation', v.quotation_id, { version: v.version_no, decision: input.decision, acknowledged: yellow });
    await emitEvent(tx, ctx, 'ENGINEERING_DECIDED', `engineering:${v.id}`, { type: 'market_quotation', id: v.quotation_id }, { decision: input.decision });
    await afterDecision(tx, v, next);
  });
}

export const pricingDecisionSchema = z.object({ versionId: zUuid, decision: zEnum(['APPROVED', 'REJECTED'] as const), note: zText(2000) });
/** Owner approval of a discount above the limit or a margin below the floor. */
export async function pricingExceptionDecision(ctx: Ctx, input: z.infer<typeof pricingDecisionSchema>): Promise<void> {
  requirePerm(ctx, 'pricing.approve');
  await withCtx(ctx, async (tx) => {
    const v = await tx.one<Rec>(
      `select v.*, q.status as q_status, q.current_version_id, q.quotation_number, q.customer_id, q.lead_id from market_quotation_versions v
         join market_quotations q on q.id = v.quotation_id where v.id = $1 for update of q`, [input.versionId]);
    if (v.current_version_id !== v.id || v.q_status !== 'PENDING_OWNER_APPROVAL') throw new AppError('INVALID_TRANSITION');
    await tx.exec(
      `insert into market_quotation_approvals (quotation_id, version_id, kind, decision, note, decided_by) values ($1,$2,'PRICING_EXCEPTION',$3,$4,$5)`,
      [v.quotation_id, v.id, input.decision, input.note, ctx.userId]);
    const next: MarketQuotationStatus = input.decision === 'APPROVED' ? 'ISSUED' : 'REJECTED';
    await tx.exec('update market_quotations set status = $2, status_reason = $3, updated_at = now() where id = $1', [v.quotation_id, next, input.decision === 'REJECTED' ? input.note : null]);
    await audit(tx, ctx, 'market_quotation.pricing_exception', 'market_quotation', v.quotation_id, { version: v.version_no, decision: input.decision });
    await emitEvent(tx, ctx, 'PRICING_EXCEPTION_DECIDED', `pricing-exception:${v.id}`, { type: 'market_quotation', id: v.quotation_id }, { decision: input.decision });
    await afterDecision(tx, v, next);
  });
}

async function afterDecision(tx: Tx, v: Rec, next: MarketQuotationStatus): Promise<void> {
  if (next === 'ISSUED') {
    await notifyCustomer(tx, v.customer_id, 'MARKET_QUOTE_ISSUED', { number: v.quotation_number }, `/customer/shop/quotations/${v.quotation_id}`);
  } else if (next === 'PENDING_OWNER_APPROVAL') {
    await notifyPermission(tx, 'pricing.approve', 'OWNER_APPROVAL_DUE', { number: v.quotation_number }, `/admin/marketplace/quotations/${v.quotation_id}`);
  }
}

/** Housekeeping: open quotations past their validity date expire (prices are never silently extended). */
export async function expireMarketQuotations(tx: Tx): Promise<number> {
  return tx.exec(
    `update market_quotations q set status = 'EXPIRED', status_reason = 'Validity date passed', updated_at = now()
       from market_quotation_versions v where v.id = q.current_version_id and q.status = any($1) and v.valid_until < (now() at time zone 'Asia/Kolkata')::date`,
    [OPEN]);
}

// ───────────── reads ─────────────
/** Quotation for its customer (no internal costs) or for AIEC staff (with costs, approvals and events). */
export async function getMarketQuotation(ctx: Ctx, id: string) {
  const staff = ctx.isInternal && ctx.permissions.has('market.view');
  if (!staff) requireCustomer(ctx);
  return withCtx(ctx, async (tx) => {
    const q = await tx.one<Rec>(
      `select q.*, c.config_number, c.name as config_name, l.lead_number, l.project_name from market_quotations q
         join configurations c on c.id = q.configuration_id join leads l on l.id = q.lead_id where q.id = $1`, [id]);
    const versions = await tx.query<Rec>('select * from market_quotation_versions where quotation_id = $1 order by version_no desc', [id]);
    const approvals = await tx.query<Rec>(
      `select a.*, u.full_name as decided_by_name from market_quotation_approvals a join users u on u.id = a.decided_by where a.quotation_id = $1 order by a.created_at`, [id]);
    const costs = staff ? await tx.query<Rec>('select * from market_quotation_costs where version_id = any($1)', [versions.map((v) => v.id)]) : [];
    const events = staff ? await tx.query<Rec>(
      `select e.event_type, e.status, e.created_at, u.full_name as actor from automation_events e left join users u on u.id = e.actor_id
        where (e.entity_type = 'market_quotation' and e.entity_id = $1) or (e.entity_type = 'configuration' and e.entity_id = $2) order by e.created_at`,
      [id, q.configuration_id]) : [];
    return { quotation: q, current: versions.find((v) => v.id === q.current_version_id) ?? null, versions, approvals, costs, events, staff };
  });
}

export async function listMarketQuotations(ctx: Ctx, filter: { status?: string } = {}) {
  requirePerm(ctx, 'market.view');
  return withCtx(ctx, (tx) => tx.query<Rec>(
    `select q.id, q.quotation_number, q.status, q.execution_model, q.updated_at, l.lead_number, l.project_name, cu.name as customer,
            v.version_no, v.price_basis, v.compat_status, v.total_payable, v.valid_until, v.needs_owner_approval
       from market_quotations q join leads l on l.id = q.lead_id join customers cu on cu.id = q.customer_id
       left join market_quotation_versions v on v.id = q.current_version_id
      where ($1::text is null or q.status = $1) order by q.updated_at desc limit 200`, [filter.status ?? null]));
}
