// AIEC Contract execution model (brief sections 10, 12, 14): AIEC is the contracting party with
// the customer, engages an eligible licensed partner, invoices the customer per milestone,
// verifies payments (staff or signed gateway webhook – never the browser), handles refunds and
// pays the partner per verified milestone. Marketplace orders never touch these tables.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { fromPaise, rateToE4, toPaise } from '@/lib/commission';
import { CUSTOMER_PAYMENT_MODE } from '@/lib/enums';
import { AppError } from '@/lib/errors';
import { isoDateIST } from '@/lib/format';
import { zDate, zEnum, zInt, zMoney, zOptDate, zOptText, zText, zUuid } from '@/lib/validation';
import { audit, notifyCompany, notifyCustomer, notifyPermission } from '../audit';
import { requireCustomer, requirePerm, type Ctx } from '../ctx';
import { withCtx, withSystem, type Rec, type Tx } from '../db';
import { emitEvent } from './automation';
import { saveFile } from './files';
import { transitionLead } from './leads';
import { assertPartnerFitForWork } from './partners';

type Upload = { name: string; type: string; bytes: Buffer } | null;

// ───────────── order creation ─────────────
export const aiecOrderSchema = z.object({
  quotationId: zUuid, companyId: zUuid, partnerPayoutValue: zMoney, scopeNote: zOptText(2000),
  contractReference: zText(200), contractAcceptedOn: zDate, approvalPathNote: zText(2000),
});

/** Partners that may be engaged: active elevator companies with valid licence and insurance, serving the project zone. */
export async function listEligiblePartners(tx: Tx, zoneId: string): Promise<Rec[]> {
  return tx.query<Rec>(
    `select c.id, c.legal_name, c.grade, c.max_concurrent_projects, app.active_project_count(c.id) as active_projects
       from companies c
      where c.category = 'ELEVATOR_COMPANY' and c.status = 'ACTIVE' and not c.safety_block
        and exists (select 1 from partner_service_areas a where a.company_id = c.id and a.zone_id = $1)
        and exists (select 1 from company_licenses l where l.company_id = c.id and l.license_type = 'LIFT_CONTRACTOR' and l.verification_status = 'VERIFIED'
                     and l.expiry_date >= (now() at time zone 'Asia/Kolkata')::date)
      order by c.legal_name`, [zoneId]);
}

/**
 * Creates the AIEC Contract order from an accepted package quotation and invites the chosen
 * licensed partner. The partner payout must leave AIEC its material cost, otherwise the
 * contract would be loss-making; the existing confirmation checklist and capacity lock follow.
 */
export async function createAiecOrder(ctx: Ctx, input: z.infer<typeof aiecOrderSchema>, contractFile: Upload): Promise<string> {
  requirePerm(ctx, 'order.manage');
  requirePerm(ctx, 'market.quote');
  if (toPaise(input.partnerPayoutValue) <= 0n) throw new AppError('VALIDATION', undefined, { partnerPayoutValue: 'INVALID_AMOUNT' });
  if (input.contractAcceptedOn > isoDateIST()) throw new AppError('VALIDATION', undefined, { contractAcceptedOn: 'INVALID_DATE' });
  return withCtx(ctx, async (tx) => {
    const q = await tx.one<Rec>(
      `select q.*, v.total_payable, v.selling_price, c.material_cost, l.zone_id, l.status as lead_status, l.lead_number
         from market_quotations q join market_quotation_versions v on v.id = q.accepted_version_id
         join market_quotation_costs c on c.version_id = v.id join leads l on l.id = q.lead_id where q.id = $1 for update of q`, [input.quotationId]);
    if (q.status !== 'ACCEPTED' || q.execution_model !== 'AIEC_CONTRACT') throw new AppError('NOT_AIEC_CONTRACT');
    if (await tx.maybeOne(`select 1 from orders where market_quotation_id = $1 and status not in ('PARTNER_DECLINED','CANCELLED')`, [q.id])) throw new AppError('ORDER_EXISTS');
    const partner = await tx.one<Rec>('select id, category, legal_name from companies where id = $1', [input.companyId]);
    if (partner.category !== 'ELEVATOR_COMPANY') throw new AppError('PARTNER_NOT_ACTIVE');
    await assertPartnerFitForWork(tx, partner.id);
    if (!(await tx.maybeOne('select 1 from partner_service_areas where company_id = $1 and zone_id = $2', [partner.id, q.zone_id]))) throw new AppError('PARTNER_ZONE');
    if (toPaise(input.partnerPayoutValue) > toPaise(q.selling_price) - toPaise(q.material_cost)) {
      throw new AppError('PAYOUT_EXCEEDS_BUDGET', undefined, { partnerPayoutValue: 'INVALID_AMOUNT' });
    }
    const fileId = contractFile ? await saveFile(tx, ctx, contractFile, 'CONTRACT', { customerId: q.customer_id }) : null;
    const order = await tx.one<{ id: string; order_number: string }>(
      `insert into orders (lead_id, company_id, customer_id, execution_model, market_quotation_id, market_quotation_version_id, gross_order_value,
              partner_payout_value, partner_scope_note, contract_reference, contract_accepted_on, contract_file_id, approval_path_note)
       values ($1,$2,$3,'AIEC_CONTRACT',$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id, order_number`,
      [q.lead_id, partner.id, q.customer_id, q.id, q.accepted_version_id, q.total_payable, input.partnerPayoutValue, input.scopeNote ?? null,
        input.contractReference, input.contractAcceptedOn, fileId, input.approvalPathNote]);
    await tx.exec(`insert into order_state_events (order_id, to_status, actor_id, reason) values ($1, 'PENDING_PARTNER_ACCEPTANCE', $2, 'AIEC Contract order created')`, [order.id, ctx.userId]);
    if (q.lead_status !== 'ORDER_PENDING') await transitionLead(tx, ctx, q.lead_id, 'ORDER_PENDING', { note: `AIEC Contract order ${order.order_number}` });
    await audit(tx, ctx, 'order.aiec_create', 'order', order.id, { quotation: q.quotation_number, partner: partner.id, payout: input.partnerPayoutValue }, partner.id);
    await emitEvent(tx, ctx, 'AIEC_ORDER_CREATED', `aiec-order:${order.id}`, { type: 'order', id: order.id }, { quotation: q.id });
    await notifyCompany(tx, partner.id, 'AIEC_ORDER_INVITED', { number: order.order_number }, `/partner/orders/${order.id}`);
    return order.id;
  });
}

// ───────────── customer invoices ─────────────
async function refreshInvoiceStatus(tx: Tx, invoiceId: string): Promise<void> {
  const r = await tx.one<{ total: string; paid: string; status: string }>(
    `select i.total_amount::text as total, i.status,
            coalesce((select sum(p.amount - p.refunded_amount) from customer_payments p where p.invoice_id = i.id and p.status = 'VERIFIED'), 0)::text as paid
       from customer_invoices i where i.id = $1`, [invoiceId]);
  if (r.status === 'CANCELLED') return;
  const paid = toPaise(r.paid); const total = toPaise(r.total);
  const next = paid >= total ? 'PAID' : paid > 0n ? 'PARTLY_PAID' : 'ISSUED';
  if (next !== r.status) await tx.exec('update customer_invoices set status = $2 where id = $1', [invoiceId, next]);
}

/** Splits a GST-inclusive amount into taxable value and GST at the quotation's rate (paise, rounded). */
export function splitGst(total: string, gstPercent: string): { taxable: string; gst: string } {
  // rateToE4: 18% → 180000 (percent × 10_000), so 1 + rate = (1_000_000 + r) / 1_000_000.
  const t = toPaise(total); const d = 1_000_000n + rateToE4(gstPercent);
  const taxable = (t * 1_000_000n * 2n + d) / (2n * d);
  return { taxable: fromPaise(taxable), gst: fromPaise(t - taxable) };
}

export const invoiceSchema = z.object({ milestoneId: zUuid, dueDays: zInt(0, 90).default(7) });
export async function issueCustomerInvoice(ctx: Ctx, input: z.infer<typeof invoiceSchema>): Promise<string> {
  requirePerm(ctx, 'payment.reconcile');
  return withCtx(ctx, async (tx) => {
    const m = await tx.one<Rec>(
      `select m.*, p.order_id, p.customer_id, p.lead_id, o.execution_model, o.order_number, v.gst_percent::text as gst_percent
         from project_milestones m join projects p on p.id = m.project_id join orders o on o.id = p.order_id
         left join market_quotation_versions v on v.id = o.market_quotation_version_id where m.id = $1 for update of m`, [input.milestoneId]);
    if (m.execution_model !== 'AIEC_CONTRACT') throw new AppError('NOT_AIEC_CONTRACT');
    if (await tx.maybeOne(`select 1 from customer_invoices where milestone_id = $1 and status <> 'CANCELLED'`, [m.id])) throw new AppError('INVOICE_EXISTS');
    const { taxable, gst } = splitGst(m.amount_due, m.gst_percent);
    const today = isoDateIST();
    const due = new Date(`${today}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + input.dueDays);
    const inv = await tx.one<{ id: string; invoice_number: string }>(
      `insert into customer_invoices (order_id, project_id, milestone_id, customer_id, taxable_amount, gst_percent, gst_amount, total_amount, issue_date, due_date, issued_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, invoice_number`,
      [m.order_id, m.project_id, m.id, m.customer_id, taxable, m.gst_percent, gst, m.amount_due, today, due.toISOString().slice(0, 10), ctx.userId]);
    await audit(tx, ctx, 'aiec.invoice_issue', 'customer_invoice', inv.id, { milestone: m.name, total: m.amount_due });
    await emitEvent(tx, ctx, 'CUSTOMER_INVOICE_ISSUED', `invoice:${m.id}`, { type: 'order', id: m.order_id }, { invoice: inv.invoice_number });
    await notifyCustomer(tx, m.customer_id, 'AIEC_INVOICE_ISSUED', { number: inv.invoice_number }, `/customer/shop/projects/${m.lead_id}`);
    return inv.id;
  });
}

export const cancelInvoiceSchema = z.object({ id: zUuid, reason: zText(500) });
export async function cancelCustomerInvoice(ctx: Ctx, input: z.infer<typeof cancelInvoiceSchema>): Promise<void> {
  requirePerm(ctx, 'payment.reconcile');
  await withCtx(ctx, async (tx) => {
    const inv = await tx.one<Rec>('select * from customer_invoices where id = $1 for update', [input.id]);
    if (inv.status !== 'ISSUED') throw new AppError('INVOICE_HAS_PAYMENTS');
    if (await tx.maybeOne(`select 1 from customer_payments where invoice_id = $1 and status <> 'REJECTED'`, [inv.id])) throw new AppError('INVOICE_HAS_PAYMENTS');
    await tx.exec(`update customer_invoices set status = 'CANCELLED', cancel_reason = $2 where id = $1`, [inv.id, input.reason]);
    await audit(tx, ctx, 'aiec.invoice_cancel', 'customer_invoice', inv.id, { reason: input.reason });
  });
}

// ───────────── customer payments ─────────────
export const paymentSchema = z.object({ invoiceId: zUuid, amount: zMoney, paymentMode: zEnum(CUSTOMER_PAYMENT_MODE), reference: zText(120), paidOn: zDate });

async function outstanding(tx: Tx, invoiceId: string): Promise<bigint> {
  const r = await tx.one<{ total: string; claimed: string }>(
    `select i.total_amount::text as total,
            coalesce((select sum(p.amount - p.refunded_amount) from customer_payments p where p.invoice_id = i.id and p.status <> 'REJECTED'), 0)::text as claimed
       from customer_invoices i where i.id = $1`, [invoiceId]);
  return toPaise(r.total) - toPaise(r.claimed);
}

/**
 * Records a payment claim: by AIEC finance (from the bank statement) or by the customer ("I have paid",
 * with the UTR). Either way it stays PENDING_VERIFICATION until a different finance user verifies it.
 */
export async function recordCustomerPayment(ctx: Ctx, input: z.infer<typeof paymentSchema>): Promise<string> {
  const staff = ctx.isInternal && ctx.permissions.has('payment.reconcile');
  const customerId = staff ? null : requireCustomer(ctx);
  if (toPaise(input.amount) <= 0n) throw new AppError('VALIDATION', undefined, { amount: 'INVALID_AMOUNT' });
  if (input.paidOn > isoDateIST()) throw new AppError('VALIDATION', undefined, { paidOn: 'INVALID_DATE' });
  if (input.paymentMode === 'GATEWAY') throw new AppError('VALIDATION', undefined, { paymentMode: 'INVALID' });
  if (customerId) await withCtx(ctx, (tx) => tx.one('select 1 from customer_invoices where id = $1 and customer_id = $2', [input.invoiceId, customerId]));
  return withSystem(async (tx) => {
    const inv = await tx.one<Rec>('select * from customer_invoices where id = $1 for update', [input.invoiceId]);
    if (inv.status === 'CANCELLED' || inv.status === 'PAID') throw new AppError('INVALID_TRANSITION');
    if (toPaise(input.amount) > await outstanding(tx, inv.id)) throw new AppError('AMOUNT_EXCEEDS', undefined, { amount: 'INVALID_AMOUNT' });
    const row = await tx.one<{ id: string }>(
      `insert into customer_payments (invoice_id, order_id, customer_id, amount, payment_mode, reference, paid_on, recorded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [inv.id, inv.order_id, inv.customer_id, input.amount, input.paymentMode, input.reference.trim(), input.paidOn, ctx.userId]);
    await audit(tx, ctx, 'aiec.payment_record', 'customer_payment', row.id, { invoice: inv.invoice_number, amount: input.amount, by: staff ? 'staff' : 'customer' });
    await notifyPermission(tx, 'payment.reconcile', 'AIEC_PAYMENT_TO_VERIFY', { number: inv.invoice_number }, `/admin/orders/${inv.order_id}`);
    return row.id;
  });
}

export const verifyPaymentSchema = z.object({ id: zUuid, decision: zEnum(['VERIFIED', 'REJECTED'] as const), note: zOptText(500) });
/** Maker-checker: the person who recorded a payment cannot verify it. */
export async function verifyCustomerPayment(ctx: Ctx, input: z.infer<typeof verifyPaymentSchema>): Promise<void> {
  requirePerm(ctx, 'payment.reconcile');
  if (input.decision === 'REJECTED' && !input.note) throw new AppError('REASON_REQUIRED');
  await withCtx(ctx, async (tx) => {
    const p = await tx.one<Rec>(`select p.*, i.invoice_number, o.lead_id from customer_payments p join customer_invoices i on i.id = p.invoice_id
                                  join orders o on o.id = p.order_id where p.id = $1 for update of p`, [input.id]);
    if (p.status !== 'PENDING_VERIFICATION') throw new AppError('INVALID_TRANSITION');
    if (p.recorded_by === ctx.userId) throw new AppError('SAME_PERSON_VERIFY');
    await tx.exec(`update customer_payments set status = $2, verification_basis = $3, verified_by = $4, verified_at = now(), review_note = $5 where id = $1`,
      [p.id, input.decision, input.decision === 'VERIFIED' ? 'BANK_STATEMENT' : null, ctx.userId, input.note ?? null]);
    await refreshInvoiceStatus(tx, p.invoice_id);
    await audit(tx, ctx, 'aiec.payment_verify', 'customer_payment', p.id, { decision: input.decision, amount: p.amount });
    if (input.decision === 'VERIFIED') {
      await emitEvent(tx, ctx, 'PAYMENT_VERIFIED', `payment-verified:${p.id}`, { type: 'order', id: p.order_id }, { amount: p.amount });
    }
    await notifyCustomer(tx, p.customer_id, input.decision === 'VERIFIED' ? 'AIEC_PAYMENT_VERIFIED' : 'AIEC_PAYMENT_REJECTED', { number: p.invoice_number }, `/customer/shop/projects/${p.lead_id}`);
  });
}

export const refundSchema = z.object({ paymentId: zUuid, amount: zMoney, reason: zText(1000), reference: zOptText(120) });
export async function refundCustomerPayment(ctx: Ctx, input: z.infer<typeof refundSchema>): Promise<void> {
  requirePerm(ctx, 'payment.reconcile');
  await withCtx(ctx, async (tx) => {
    const p = await tx.one<Rec>('select * from customer_payments where id = $1 for update', [input.paymentId]);
    if (p.status !== 'VERIFIED') throw new AppError('INVALID_TRANSITION');
    if (toPaise(input.amount) <= 0n || toPaise(input.amount) > toPaise(p.amount) - toPaise(p.refunded_amount)) throw new AppError('VALIDATION', undefined, { amount: 'INVALID_AMOUNT' });
    await tx.exec('update customer_payments set refunded_amount = refunded_amount + $2::numeric where id = $1', [p.id, input.amount]);
    await tx.exec('insert into customer_refunds (payment_id, order_id, amount, reason, reference, recorded_by) values ($1,$2,$3,$4,$5,$6)',
      [p.id, p.order_id, input.amount, input.reason, input.reference ?? null, ctx.userId]);
    await refreshInvoiceStatus(tx, p.invoice_id);
    await audit(tx, ctx, 'aiec.refund', 'customer_payment', p.id, { amount: input.amount, reason: input.reason });
  });
}

// ───────────── partner payouts ─────────────
export const payoutSchema = z.object({ id: zUuid, action: zEnum(['APPROVE', 'HOLD', 'PAID'] as const), reason: zOptText(500), reference: zOptText(120), paidOn: zOptDate });
/**
 * Owner-level payout control. Approval needs the milestone completed, no open high/critical
 * defects and no stop-work order; payment needs approval and a bank reference.
 */
export async function actOnPayout(ctx: Ctx, input: z.infer<typeof payoutSchema>): Promise<void> {
  requirePerm(ctx, 'payout.approve');
  await withCtx(ctx, async (tx) => {
    const po = await tx.one<Rec>(
      `select po.*, m.status as milestone_status, m.name as milestone_name, p.status as project_status, o.order_number
         from partner_payouts po join project_milestones m on m.id = po.milestone_id join projects p on p.id = po.project_id
         join orders o on o.id = po.order_id where po.id = $1 for update of po`, [input.id]);
    if (input.action === 'APPROVE') {
      if (!['PENDING', 'HELD'].includes(po.status)) throw new AppError('INVALID_TRANSITION');
      if (po.milestone_status !== 'COMPLETED') throw new AppError('MILESTONE_NOT_COMPLETED');
      if (po.project_status === 'STOP_WORK') throw new AppError('PROJECT_STOP_WORK');
      const defects = (await tx.one<{ n: number }>(
        `select count(*) as n from qc_defects where project_id = $1 and status in ('OPEN','CORRECTIVE_ACTION') and severity in ('HIGH','CRITICAL')`, [po.project_id])).n;
      if (defects) throw new AppError('OPEN_DEFECTS');
      await tx.exec(`update partner_payouts set status = 'APPROVED', approved_by = $2, approved_at = now(), hold_reason = null where id = $1`, [po.id, ctx.userId]);
    } else if (input.action === 'HOLD') {
      if (!['PENDING', 'APPROVED'].includes(po.status)) throw new AppError('INVALID_TRANSITION');
      if (!input.reason) throw new AppError('REASON_REQUIRED');
      await tx.exec(`update partner_payouts set status = 'HELD', hold_reason = $2 where id = $1`, [po.id, input.reason]);
    } else {
      if (po.status !== 'APPROVED') throw new AppError('INVALID_TRANSITION');
      if (!input.reference || !input.paidOn) throw new AppError('VALIDATION', undefined, { reference: input.reference ? '' : 'REQUIRED', paidOn: input.paidOn ? '' : 'REQUIRED' });
      if (input.paidOn > isoDateIST()) throw new AppError('VALIDATION', undefined, { paidOn: 'INVALID_DATE' });
      await tx.exec(`update partner_payouts set status = 'PAID', paid_reference = $2, paid_on = $3, paid_by = $4 where id = $1`, [po.id, input.reference, input.paidOn, ctx.userId]);
    }
    await audit(tx, ctx, `aiec.payout_${input.action.toLowerCase()}`, 'partner_payout', po.id, { amount: po.amount, reason: input.reason ?? null, reference: input.reference ?? null }, po.company_id);
    await notifyCompany(tx, po.company_id, 'AIEC_PAYOUT_STATUS', { number: po.order_number, name: po.milestone_name, status: input.action }, `/partner/orders/${po.order_id}`);
  });
}

// ───────────── reads ─────────────
/** Money view of one AIEC Contract order. Staff see everything; the partner sees only its payouts. */
export async function getAiecFinance(ctx: Ctx, orderId: string) {
  return withCtx(ctx, async (tx) => {
    const order = await tx.one<Rec>('select id, execution_model, company_id, gross_order_value, partner_payout_value, lead_id from orders where id = $1', [orderId]);
    if (order.execution_model !== 'AIEC_CONTRACT') return null;
    const staff = ctx.isInternal;
    const [milestones, invoices, payments, refunds, payouts] = await Promise.all([
      tx.query<Rec>(`select m.* from project_milestones m join projects p on p.id = m.project_id where p.order_id = $1 order by m.seq`, [orderId]),
      staff ? tx.query<Rec>('select * from customer_invoices where order_id = $1 order by issue_date, invoice_number', [orderId]) : Promise.resolve([] as Rec[]),
      staff ? tx.query<Rec>(`select p.*, u.full_name as recorded_by_name from customer_payments p left join users u on u.id = p.recorded_by where p.order_id = $1 order by p.created_at`, [orderId]) : Promise.resolve([] as Rec[]),
      staff ? tx.query<Rec>('select * from customer_refunds where order_id = $1 order by created_at', [orderId]) : Promise.resolve([] as Rec[]),
      tx.query<Rec>(`select po.*, m.name as milestone_name, m.seq, m.status as milestone_status from partner_payouts po join project_milestones m on m.id = po.milestone_id
                      where po.order_id = $1 order by m.seq`, [orderId]),
    ]);
    const sum = (rows: Rec[], f: (r: Rec) => string) => fromPaise(rows.reduce((s, r) => s + toPaise(f(r)), 0n));
    const verified = payments.filter((p) => p.status === 'VERIFIED');
    return {
      order, milestones, invoices, payments, refunds, payouts, staff,
      summary: {
        invoiced: sum(invoices.filter((i) => i.status !== 'CANCELLED'), (i) => i.total_amount),
        received: sum(verified, (p) => p.amount), refunded: sum(verified, (p) => p.refunded_amount),
        payoutApproved: sum(payouts.filter((p) => p.status === 'APPROVED'), (p) => p.amount), payoutPaid: sum(payouts.filter((p) => p.status === 'PAID'), (p) => p.amount),
      },
    };
  });
}

/** The customer's AIEC invoices and payments for one project. */
export async function getMyAiecBilling(ctx: Ctx, leadId: string) {
  const customerId = requireCustomer(ctx);
  return withCtx(ctx, async (tx) => {
    const invoices = await tx.query<Rec>(
      `select i.*, m.name as milestone_name, o.order_number from customer_invoices i join project_milestones m on m.id = i.milestone_id
         join orders o on o.id = i.order_id where o.lead_id = $1 and i.customer_id = $2 order by m.seq`, [leadId, customerId]);
    const payments = await tx.query<Rec>(
      `select p.id, p.invoice_id, p.amount, p.refunded_amount, p.payment_mode, p.reference, p.paid_on, p.status, p.review_note
         from customer_payments p where p.customer_id = $1 and p.invoice_id = any($2) order by p.created_at`, [customerId, invoices.map((i) => i.id)]);
    const order = await tx.maybeOne<Rec>(
      `select o.id, o.order_number, o.status, o.gross_order_value, co.legal_name as partner_name, (select id from projects p where p.order_id = o.id) as project_id
         from orders o join companies co on co.id = o.company_id where o.lead_id = $1 and o.customer_id = $2 and o.execution_model = 'AIEC_CONTRACT'
          and o.status not in ('PARTNER_DECLINED','CANCELLED') order by o.created_at desc limit 1`, [leadId, customerId]);
    return { order, invoices, payments };
  });
}

// ───────────── Razorpay webhook (integration ready, awaiting merchant configuration) ─────────────
/**
 * Verifies `X-Razorpay-Signature` (HMAC-SHA256 of the raw body with RAZORPAY_WEBHOOK_SECRET) and
 * records `payment.captured` against the AIEC invoice named in the payment notes (`invoice_id`).
 * Replays are ignored (webhook_events unique per event id; gateway payment id unique).
 * Until the secret is configured the endpoint refuses every request.
 */
export async function handleRazorpayWebhook(rawBody: string, signature: string | null, eventId: string | null): Promise<{ status: string }> {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new AppError('GATEWAY_NOT_CONFIGURED');
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
  const given = Buffer.from(signature ?? '');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new AppError('FORBIDDEN');
  const body = JSON.parse(rawBody) as Rec;
  const id = eventId ?? `${body.event}:${body.payload?.payment?.entity?.id ?? ''}`;
  return withSystem(async (tx) => {
    const fresh = await tx.exec(`insert into webhook_events (provider, event_id, payload) values ('razorpay', $1, $2) on conflict do nothing`, [id, rawBody]);
    if (!fresh) return { status: 'duplicate' };
    let status = 'ignored';
    const pay = body.payload?.payment?.entity as Rec | undefined;
    if (body.event === 'payment.captured' && pay?.id && pay?.notes?.invoice_id && /^[0-9a-f-]{36}$/i.test(String(pay.notes.invoice_id))) {
      const inv = await tx.maybeOne<Rec>('select * from customer_invoices where id = $1 for update', [pay.notes.invoice_id]);
      if (!inv || inv.status === 'CANCELLED' || pay.currency !== 'INR') status = 'no_match';
      else if (await tx.maybeOne('select 1 from customer_payments where gateway_payment_id = $1', [pay.id])) status = 'duplicate';
      else {
        const amount = fromPaise(BigInt(pay.amount));
        // Overpayments are recorded for manual review rather than auto-verified.
        const within = toPaise(amount) <= await outstanding(tx, inv.id);
        await tx.exec(
          `insert into customer_payments (invoice_id, order_id, customer_id, amount, payment_mode, reference, paid_on, status, verification_basis, gateway, gateway_payment_id, verified_at, review_note)
           values ($1,$2,$3,$4,'GATEWAY',$5,(now() at time zone 'Asia/Kolkata')::date,$6,$7,'RAZORPAY',$5,$8,$9)`,
          [inv.id, inv.order_id, inv.customer_id, amount, pay.id, within ? 'VERIFIED' : 'PENDING_VERIFICATION', within ? 'GATEWAY_WEBHOOK' : null,
            within ? new Date() : null, within ? null : 'Gateway amount exceeds the outstanding balance – review manually']);
        await refreshInvoiceStatus(tx, inv.id);
        await audit(tx, null, 'aiec.payment_gateway', 'customer_invoice', inv.id, { gatewayPaymentId: pay.id, amount, verified: within });
        status = within ? 'processed' : 'review';
      }
    }
    await tx.exec(`update webhook_events set result = $2 where provider = 'razorpay' and event_id = $1`, [id, status]);
    return { status };
  });
}

/** What staff need to create the AIEC Contract order from an accepted quotation (null for other quotations). */
export async function getAiecOrderSetup(ctx: Ctx, quotationId: string) {
  if (!ctx.isInternal) return null;
  return withCtx(ctx, async (tx) => {
    const q = await tx.maybeOne<Rec>(
      `select q.id, q.status, q.execution_model, l.zone_id, v.selling_price, c.material_cost from market_quotations q join leads l on l.id = q.lead_id
         left join market_quotation_versions v on v.id = q.accepted_version_id left join market_quotation_costs c on c.version_id = v.id where q.id = $1`, [quotationId]);
    if (!q || q.status !== 'ACCEPTED' || q.execution_model !== 'AIEC_CONTRACT') return null;
    const orders = await tx.query<Rec>(
      `select o.id, o.order_number, o.status, co.legal_name from orders o join companies co on co.id = o.company_id where o.market_quotation_id = $1 order by o.created_at desc`, [quotationId]);
    return {
      orders, live: orders.find((o) => !['PARTNER_DECLINED', 'CANCELLED'].includes(o.status)) ?? null,
      partners: await listEligiblePartners(tx, q.zone_id),
      maxPayout: fromPaise(toPaise(q.selling_price) - toPaise(q.material_cost)),
    };
  });
}
