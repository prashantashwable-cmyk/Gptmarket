// Supplier purchase orders for AIEC Contract projects (brief section 8): issue from the frozen
// quotation costs, supplier acknowledgement and dispatch, AIEC delivery confirmation and an
// owner-recorded supplier payment ledger.
import { z } from 'zod';
import { fromPaise, toPaise } from '@/lib/commission';
import { AppError } from '@/lib/errors';
import { isoDateIST } from '@/lib/format';
import { zDate, zEnum, zMoney, zOptDate, zOptText, zText, zUuid } from '@/lib/validation';
import { audit, notifyCompany, notifyPermission } from '../audit';
import { requireCompany, requirePerm, type Ctx } from '../ctx';
import { withCtx, type Rec, type Tx } from '../db';
import { emitEvent } from './automation';

type CostLine = { productId: string; unitCost: string; quantity: number; lineCost: string };

/** Creates one purchase order per supplier from the accepted quotation's frozen cost lines. Idempotent. */
export async function generatePurchaseOrders(ctx: Ctx, orderId: string): Promise<number> {
  requirePerm(ctx, 'order.manage');
  return withCtx(ctx, async (tx) => {
    const o = await tx.one<Rec>(
      `select o.*, l.project_name, l.address, z.code as zone_code from orders o join leads l on l.id = o.lead_id join zones z on z.id = l.zone_id
        where o.id = $1 for update of o`, [orderId]);
    if (o.execution_model !== 'AIEC_CONTRACT') throw new AppError('NOT_AIEC_CONTRACT');
    if (!['CONFIRMED', 'COMPLETED'].includes(o.status)) throw new AppError('ORDER_NOT_CONFIRMED');
    const c = await tx.one<{ cost_lines: CostLine[] }>('select cost_lines from market_quotation_costs where version_id = $1', [o.market_quotation_version_id]);
    const products = await tx.query<Rec>('select id, company_id, name, brand, model from supplier_products where id = any($1)', [c.cost_lines.map((l) => l.productId)]);
    const bySupplier = new Map<string, Array<CostLine & { description: string }>>();
    for (const l of c.cost_lines) {
      const p = products.find((x) => x.id === l.productId);
      if (!p) throw new AppError('NOT_FOUND');
      bySupplier.set(p.company_id, [...(bySupplier.get(p.company_id) ?? []), { ...l, description: `${p.name} · ${p.brand} ${p.model}` }]);
    }
    let created = 0;
    for (const [companyId, lines] of bySupplier) {
      const total = fromPaise(lines.reduce((s, l) => s + toPaise(l.lineCost), 0n));
      const po = await tx.maybeOne<{ id: string; po_number: string }>(
        `insert into supplier_purchase_orders (order_id, company_id, total_cost, order_number, project_label, delivery_address, created_by)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (order_id, company_id) do nothing returning id, po_number`,
        [orderId, companyId, total, o.order_number, o.project_name, `${o.address} (${o.zone_code})`, ctx.userId]);
      if (!po) continue; // already issued
      for (const l of lines) {
        await tx.exec('insert into supplier_po_lines (po_id, product_id, description, quantity, unit_cost, line_total) values ($1,$2,$3,$4,$5,$6)',
          [po.id, l.productId, l.description, l.quantity, l.unitCost, l.lineCost]);
      }
      await audit(tx, ctx, 'supplier_po.issue', 'supplier_po', po.id, { order: o.order_number, total }, companyId);
      await emitEvent(tx, ctx, 'SUPPLIER_PO_ISSUED', `supplier-po:${po.id}`, { type: 'order', id: orderId }, { po: po.po_number });
      await notifyCompany(tx, companyId, 'SUPPLIER_PO_ISSUED', { number: po.po_number }, '/partner/supplier-orders');
      created++;
    }
    return created;
  });
}

export const supplierPoActionSchema = z.object({ id: zUuid, action: zEnum(['ACKNOWLEDGE', 'DISPATCH'] as const), expectedDelivery: zOptDate, reference: zOptText(120) });
/** Supplier acknowledges (with expected delivery date) and dispatches (with a dispatch reference). */
export async function supplierPoAction(ctx: Ctx, input: z.infer<typeof supplierPoActionSchema>): Promise<void> {
  requirePerm(ctx, 'catalogue.manage');
  const companyId = requireCompany(ctx);
  await withCtx(ctx, async (tx) => {
    const po = await tx.one<Rec>('select * from supplier_purchase_orders where id = $1 and company_id = $2 for update', [input.id, companyId]);
    if (input.action === 'ACKNOWLEDGE') {
      if (po.status !== 'ISSUED') throw new AppError('INVALID_TRANSITION');
      if (!input.expectedDelivery) throw new AppError('VALIDATION', undefined, { expectedDelivery: 'REQUIRED' });
      if (input.expectedDelivery < isoDateIST()) throw new AppError('VALIDATION', undefined, { expectedDelivery: 'INVALID_DATE' });
      await tx.exec(`update supplier_purchase_orders set status = 'ACKNOWLEDGED', expected_delivery = $2 where id = $1`, [po.id, input.expectedDelivery]);
    } else {
      if (!['ISSUED', 'ACKNOWLEDGED'].includes(po.status)) throw new AppError('INVALID_TRANSITION');
      if (!input.reference) throw new AppError('VALIDATION', undefined, { reference: 'REQUIRED' });
      await tx.exec(`update supplier_purchase_orders set status = 'DISPATCHED', dispatch_reference = $2, dispatched_at = now() where id = $1`, [po.id, input.reference]);
      // Automation: material dispatched → notify operations.
      if (await emitEvent(tx, ctx, 'MATERIAL_DISPATCHED', `po-dispatch:${po.id}`, { type: 'order', id: po.order_id }, { po: po.po_number, reference: input.reference })) {
        await notifyPermission(tx, 'project.manage', 'MATERIAL_DISPATCHED', { number: po.po_number, order: po.order_number }, `/admin/orders/${po.order_id}`);
      }
    }
    await audit(tx, ctx, `supplier_po.${input.action.toLowerCase()}`, 'supplier_po', po.id, { reference: input.reference ?? null, expectedDelivery: input.expectedDelivery ?? null }, companyId);
  });
}

export const poStaffSchema = z.object({ id: zUuid, action: zEnum(['DELIVERED', 'CANCEL'] as const), reason: zOptText(500) });
export async function staffPoAction(ctx: Ctx, input: z.infer<typeof poStaffSchema>): Promise<void> {
  requirePerm(ctx, 'order.manage', 'project.manage');
  await withCtx(ctx, async (tx) => {
    const po = await tx.one<Rec>('select * from supplier_purchase_orders where id = $1 for update', [input.id]);
    if (input.action === 'DELIVERED') {
      if (po.status !== 'DISPATCHED') throw new AppError('INVALID_TRANSITION');
      await tx.exec(`update supplier_purchase_orders set status = 'DELIVERED', delivered_at = now(), received_by = $2 where id = $1`, [po.id, ctx.userId]);
    } else {
      if (!['ISSUED', 'ACKNOWLEDGED'].includes(po.status)) throw new AppError('INVALID_TRANSITION');
      if (!input.reason) throw new AppError('REASON_REQUIRED');
      await tx.exec(`update supplier_purchase_orders set status = 'CANCELLED', cancel_reason = $2 where id = $1`, [po.id, input.reason]);
    }
    await audit(tx, ctx, `supplier_po.${input.action.toLowerCase()}`, 'supplier_po', po.id, { reason: input.reason ?? null }, po.company_id);
    await notifyCompany(tx, po.company_id, 'SUPPLIER_PO_STATUS', { number: po.po_number, status: input.action }, '/partner/supplier-orders');
  });
}

export const supplierPaymentSchema = z.object({ poId: zUuid, amount: zMoney, reference: zText(120), paidOn: zDate });
/** Owner records a payment to the supplier; total payments can never exceed the purchase order. */
export async function recordSupplierPayment(ctx: Ctx, input: z.infer<typeof supplierPaymentSchema>): Promise<void> {
  requirePerm(ctx, 'payout.approve');
  if (input.paidOn > isoDateIST()) throw new AppError('VALIDATION', undefined, { paidOn: 'INVALID_DATE' });
  await withCtx(ctx, async (tx) => {
    const po = await tx.one<Rec>('select * from supplier_purchase_orders where id = $1 for update', [input.poId]);
    if (po.status === 'CANCELLED') throw new AppError('INVALID_TRANSITION');
    const paid = (await tx.one<{ s: string }>('select coalesce(sum(amount), 0)::text as s from supplier_payments where po_id = $1', [po.id])).s;
    if (toPaise(input.amount) <= 0n || toPaise(paid) + toPaise(input.amount) > toPaise(po.total_cost)) throw new AppError('AMOUNT_EXCEEDS', undefined, { amount: 'INVALID_AMOUNT' });
    await tx.exec('insert into supplier_payments (po_id, company_id, amount, reference, paid_on, recorded_by) values ($1,$2,$3,$4,$5,$6)',
      [po.id, po.company_id, input.amount, input.reference, input.paidOn, ctx.userId]);
    await audit(tx, ctx, 'supplier_po.payment', 'supplier_po', po.id, { amount: input.amount, reference: input.reference }, po.company_id);
    await notifyCompany(tx, po.company_id, 'SUPPLIER_PAYMENT', { number: po.po_number }, '/partner/supplier-orders');
  });
}

async function withLines(tx: Tx, pos: Rec[]): Promise<Rec[]> {
  if (!pos.length) return [];
  const ids = pos.map((p) => p.id);
  const [lines, payments] = await Promise.all([
    tx.query<Rec>('select * from supplier_po_lines where po_id = any($1) order by description', [ids]),
    tx.query<Rec>('select * from supplier_payments where po_id = any($1) order by paid_on', [ids]),
  ]);
  return pos.map((p) => {
    const pays = payments.filter((x) => x.po_id === p.id);
    const paid = fromPaise(pays.reduce((s, x) => s + toPaise(x.amount), 0n));
    return { ...p, lines: lines.filter((l) => l.po_id === p.id), payments: pays, paid, outstanding: fromPaise(toPaise(p.total_cost) - toPaise(paid)) } as Rec;
  });
}

/** Purchase orders of one AIEC Contract order (AIEC staff). */
export async function getOrderPurchaseOrders(ctx: Ctx, orderId: string): Promise<Rec[] | null> {
  if (!ctx.isInternal) return null;
  return withCtx(ctx, async (tx) => {
    const o = await tx.one<Rec>('select execution_model from orders where id = $1', [orderId]);
    if (o.execution_model !== 'AIEC_CONTRACT') return null;
    const pos = await tx.query<Rec>(
      `select po.*, c.legal_name as supplier from supplier_purchase_orders po join companies c on c.id = po.company_id where po.order_id = $1 order by c.legal_name`, [orderId]);
    return withLines(tx, pos);
  });
}

/** The supplier's own purchase orders and ledger. */
export async function getSupplierOrders(ctx: Ctx) {
  requirePerm(ctx, 'catalogue.manage');
  const companyId = requireCompany(ctx);
  return withCtx(ctx, async (tx) => {
    const pos = await tx.query<Rec>('select * from supplier_purchase_orders where company_id = $1 order by created_at desc', [companyId]);
    const rows = await withLines(tx, pos);
    const live = rows.filter((r) => r.status !== 'CANCELLED');
    const sum = (f: (r: Rec) => string) => fromPaise(live.reduce((s, r) => s + toPaise(f(r)), 0n));
    return { orders: rows, ledger: { total: sum((r) => r.total_cost), paid: sum((r) => r.paid), outstanding: sum((r) => r.outstanding) } };
  });
}
