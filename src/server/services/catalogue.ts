// Supplier marketplace (brief section 8): supplier products, price history and stock, with
// AIEC approval of the supplier, of each product and of each price, kept separate.
import { z } from 'zod';
import { productSpecSchemas } from '@/lib/compatibility';
import { COMPONENT_CATEGORY, PRICE_UNIT, SUPPLIER_STATUS, type ComponentCategory } from '@/lib/enums';
import { AppError } from '@/lib/errors';
import { isoDateIST } from '@/lib/format';
import { priceChangePercent } from '@/lib/pricing';
import { zDate, zEnum, zInt, zMoney, zOptText, zText, zUuid } from '@/lib/validation';
import { audit, notifyCompany, notifyPermission } from '../audit';
import { requireCompany, requirePerm, type Ctx } from '../ctx';
import { withCtx, type Rec, type Tx } from '../db';
import { emitEvent } from './automation';
import { saveFile } from './files';
import { supplierScores } from './supplier-orders';

type Upload = { name: string; type: string; bytes: Buffer } | null;

/** Price changes larger than this (either direction) are flagged for a closer AIEC review. */
export const PRICE_REVIEW_THRESHOLD_PERCENT = 25;

/** Validates the technical attributes a category requires; returns the clean object. */
export function parseSpecs(category: ComponentCategory, raw: Record<string, unknown>): Record<string, unknown> {
  const schema = productSpecSchemas[category];
  if (!schema) return {};
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[`spec_${String(issue.path[0] ?? '')}`] ??= 'INVALID';
    throw new AppError('VALIDATION', undefined, fieldErrors);
  }
  return parsed.data as Record<string, unknown>;
}

async function requireSupplierCompany(tx: Tx, ctx: Ctx): Promise<Rec> {
  requirePerm(ctx, 'catalogue.manage');
  const companyId = requireCompany(ctx);
  const company = await tx.one<Rec>('select id, category, legal_name, status, marketplace_status from companies where id = $1', [companyId]);
  if (!['SUPPLIER', 'MANUFACTURER'].includes(company.category)) throw new AppError('NOT_A_SUPPLIER');
  return company;
}

// ───────────── supplier side ─────────────
export const supplierProductSchema = z.object({
  id: zUuid.optional(),
  categoryCode: zEnum(COMPONENT_CATEGORY),
  brand: zText(120), model: zText(120), name: zText(200), description: zOptText(2000),
  priceUnit: zEnum(PRICE_UNIT).default('EACH'),
  warrantyMonths: zInt(0, 240), deliveryDays: zInt(0, 365), stockQty: zInt(0, 1_000_000),
});
export type SupplierProductInput = z.infer<typeof supplierProductSchema>;

/** Creates or edits a product. Editing an approved product sends it back for approval (engineering basis changed). */
export async function saveSupplierProduct(ctx: Ctx, input: SupplierProductInput, rawSpecs: Record<string, unknown>, files: { image: Upload; document: Upload }): Promise<string> {
  const specs = parseSpecs(input.categoryCode, rawSpecs);
  return withCtx(ctx, async (tx) => {
    const company = await requireSupplierCompany(tx, ctx);
    const imageId = files.image ? await saveFile(tx, ctx, files.image, 'PRODUCT', { companyId: company.id }) : null;
    const documentId = files.document ? await saveFile(tx, ctx, files.document, 'PRODUCT', { companyId: company.id }) : null;
    if (input.id) {
      const current = await tx.one<Rec>('select id, approval_status from supplier_products where id = $1 and company_id = $2 and deleted_at is null for update', [input.id, company.id]);
      if (current.approval_status === 'SUSPENDED') throw new AppError('PRODUCT_SUSPENDED');
      const nextStatus = current.approval_status === 'DRAFT' ? 'DRAFT' : 'SUBMITTED';
      await tx.exec(
        `update supplier_products set category_code=$2, brand=$3, model=$4, name=$5, description=$6, specs=$7, price_unit=$8, warranty_months=$9,
                delivery_days=$10, stock_qty=$11, image_file_id=coalesce($12, image_file_id), document_file_id=coalesce($13, document_file_id),
                approval_status=$14, updated_at=now() where id=$1`,
        [input.id, input.categoryCode, input.brand, input.model, input.name, input.description ?? null, JSON.stringify(specs), input.priceUnit,
          input.warrantyMonths, input.deliveryDays, input.stockQty, imageId, documentId, nextStatus]);
      await audit(tx, ctx, 'catalogue.product_update', 'supplier_product', input.id, { from: current.approval_status, to: nextStatus }, company.id);
      if (nextStatus === 'SUBMITTED' && current.approval_status !== 'SUBMITTED') {
        await notifyPermission(tx, 'catalogue.approve', 'PRODUCT_SUBMITTED', { name: input.name, company: company.legal_name }, '/admin/marketplace/catalogue');
      }
      return input.id;
    }
    const row = await tx.one<{ id: string }>(
      `insert into supplier_products (company_id, category_code, brand, model, name, description, specs, price_unit, warranty_months, delivery_days,
              stock_qty, image_file_id, document_file_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [company.id, input.categoryCode, input.brand, input.model, input.name, input.description ?? null, JSON.stringify(specs), input.priceUnit,
        input.warrantyMonths, input.deliveryDays, input.stockQty, imageId, documentId, ctx.userId]);
    await audit(tx, ctx, 'catalogue.product_create', 'supplier_product', row.id, { name: input.name, category: input.categoryCode }, company.id);
    return row.id;
  });
}

export async function submitProductForApproval(ctx: Ctx, id: string): Promise<void> {
  await withCtx(ctx, async (tx) => {
    const company = await requireSupplierCompany(tx, ctx);
    const p = await tx.one<Rec>('select id, name, approval_status from supplier_products where id = $1 and company_id = $2 and deleted_at is null for update', [id, company.id]);
    if (!['DRAFT', 'REJECTED'].includes(p.approval_status)) throw new AppError('INVALID_TRANSITION');
    await tx.exec(`update supplier_products set approval_status = 'SUBMITTED', updated_at = now() where id = $1`, [id]);
    await audit(tx, ctx, 'catalogue.product_submit', 'supplier_product', id, {}, company.id);
    await notifyPermission(tx, 'catalogue.approve', 'PRODUCT_SUBMITTED', { name: p.name, company: company.legal_name }, '/admin/marketplace/catalogue');
  });
}

/** Soft delete: the product disappears from the catalogue; history and past quotations stay intact. */
export async function withdrawProduct(ctx: Ctx, id: string): Promise<void> {
  await withCtx(ctx, async (tx) => {
    const company = await requireSupplierCompany(tx, ctx);
    const n = await tx.exec('update supplier_products set deleted_at = now(), updated_at = now() where id = $1 and company_id = $2 and deleted_at is null', [id, company.id]);
    if (!n) throw new AppError('NOT_FOUND');
    await audit(tx, ctx, 'catalogue.product_withdraw', 'supplier_product', id, {}, company.id);
  });
}

export const stockSchema = z.object({ id: zUuid, stockQty: zInt(0, 1_000_000), deliveryDays: zInt(0, 365) });
export async function updateStock(ctx: Ctx, input: z.infer<typeof stockSchema>): Promise<void> {
  await withCtx(ctx, async (tx) => {
    const company = await requireSupplierCompany(tx, ctx);
    const n = await tx.exec('update supplier_products set stock_qty = $3, delivery_days = $4, updated_at = now() where id = $1 and company_id = $2 and deleted_at is null',
      [input.id, company.id, input.stockQty, input.deliveryDays]);
    if (!n) throw new AppError('NOT_FOUND');
    await audit(tx, ctx, 'catalogue.stock_update', 'supplier_product', input.id, { stock: input.stockQty, deliveryDays: input.deliveryDays }, company.id);
  });
}

export const priceSchema = z.object({ productId: zUuid, unitPrice: zMoney, validFrom: zDate, note: zOptText(500) });
/** A new price is a new row awaiting AIEC approval; the amount of an existing row never changes. */
export async function submitPrice(ctx: Ctx, input: z.infer<typeof priceSchema>): Promise<{ id: string; flagged: boolean }> {
  if (Number(input.unitPrice) <= 0) throw new AppError('VALIDATION', undefined, { unitPrice: 'INVALID_AMOUNT' });
  return withCtx(ctx, async (tx) => {
    const company = await requireSupplierCompany(tx, ctx);
    const p = await tx.one<Rec>('select id, name from supplier_products where id = $1 and company_id = $2 and deleted_at is null', [input.productId, company.id]);
    if (input.validFrom < isoDateIST()) throw new AppError('VALIDATION', undefined, { validFrom: 'INVALID_DATE' });
    const last = await tx.maybeOne<{ unit_price: string }>(
      `select unit_price::text from supplier_product_prices where product_id = $1 and status = 'APPROVED' order by valid_from desc, created_at desc limit 1`, [p.id]);
    const change = last ? priceChangePercent(last.unit_price, input.unitPrice) : null;
    const flagged = change !== null && Math.abs(Number(change)) > PRICE_REVIEW_THRESHOLD_PERCENT;
    const row = await tx.one<{ id: string }>(
      `insert into supplier_product_prices (product_id, company_id, unit_price, valid_from, change_percent, needs_review_reason, note, submitted_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [p.id, company.id, input.unitPrice, input.validFrom, change, flagged ? 'PRICE_JUMP' : null, input.note ?? null, ctx.userId]);
    await audit(tx, ctx, 'catalogue.price_submit', 'supplier_price', row.id, { product: p.id, amount: input.unitPrice, change }, company.id);
    await notifyPermission(tx, 'catalogue.approve', flagged ? 'PRICE_FLAGGED' : 'PRICE_SUBMITTED', { name: p.name, company: company.legal_name }, '/admin/marketplace/catalogue');
    return { id: row.id, flagged };
  });
}

export async function getSupplierCatalogue(ctx: Ctx) {
  return withCtx(ctx, async (tx) => {
    const company = await requireSupplierCompany(tx, ctx);
    const products = await tx.query<Rec>(
      `select sp.*, (select pr.unit_price from supplier_product_prices pr where pr.product_id = sp.id and pr.status = 'APPROVED'
                       and pr.valid_from <= (now() at time zone 'Asia/Kolkata')::date order by pr.valid_from desc, pr.created_at desc limit 1) as current_price
         from supplier_products sp where sp.company_id = $1 and sp.deleted_at is null order by sp.category_code, sp.name`, [company.id]);
    const prices = await tx.query<Rec>(
      `select pr.*, sp.name as product_name from supplier_product_prices pr join supplier_products sp on sp.id = pr.product_id
        where pr.company_id = $1 order by pr.created_at desc limit 100`, [company.id]);
    return { company, products, prices };
  });
}

// ───────────── AIEC side ─────────────
export const supplierStatusSchema = z.object({ companyId: zUuid, status: zEnum(SUPPLIER_STATUS), reason: zOptText(500) });
export async function setSupplierStatus(ctx: Ctx, input: z.infer<typeof supplierStatusSchema>): Promise<void> {
  requirePerm(ctx, 'catalogue.approve');
  if (input.status === 'SUSPENDED' && !input.reason) throw new AppError('REASON_REQUIRED');
  await withCtx(ctx, async (tx) => {
    const c = await tx.one<Rec>('select id, legal_name, category, status, marketplace_status from companies where id = $1 for update', [input.companyId]);
    if (!['SUPPLIER', 'MANUFACTURER'].includes(c.category)) throw new AppError('NOT_A_SUPPLIER');
    if (['APPROVED', 'PREFERRED'].includes(input.status) && c.status !== 'ACTIVE') throw new AppError('SUPPLIER_KYC_INCOMPLETE');
    await tx.exec('update companies set marketplace_status = $2, marketplace_status_reason = $3, marketplace_reviewed_by = $4, marketplace_reviewed_at = now() where id = $1',
      [c.id, input.status, input.reason ?? null, ctx.userId]);
    await audit(tx, ctx, 'catalogue.supplier_status', 'company', c.id, { from: c.marketplace_status, to: input.status, reason: input.reason ?? null }, c.id);
    await emitEvent(tx, ctx, 'SUPPLIER_STATUS_CHANGED', `supplier-status:${c.id}:${input.status}:${Date.now()}`, { type: 'company', id: c.id }, { from: c.marketplace_status, to: input.status });
    await notifyCompany(tx, c.id, 'SUPPLIER_STATUS', { status: input.status }, '/partner/catalogue');
    if (input.status === 'SUSPENDED') {
      const open = (await tx.one<{ n: number }>(
        `select count(distinct q.id) as n from market_quotations q join market_quotation_versions v on v.id = q.current_version_id,
                jsonb_array_elements(v.snapshot->'lines') l
          where q.status in ('ESTIMATE','PENDING_ENGINEERING','PENDING_OWNER_APPROVAL','ISSUED') and l->>'supplierId' = $1`, [c.id])).n;
      if (open) await notifyPermission(tx, 'market.quote', 'SUPPLIER_SUSPENDED_OPEN_QUOTES', { company: c.legal_name, count: open }, '/admin/marketplace');
    }
  });
}

export const productReviewSchema = z.object({ id: zUuid, decision: zEnum(['APPROVED', 'REJECTED', 'SUSPENDED'] as const), note: zOptText(1000) });
export async function reviewProduct(ctx: Ctx, input: z.infer<typeof productReviewSchema>): Promise<void> {
  requirePerm(ctx, 'catalogue.approve');
  if (input.decision !== 'APPROVED' && !input.note) throw new AppError('REASON_REQUIRED');
  await withCtx(ctx, async (tx) => {
    const p = await tx.one<Rec>('select id, name, company_id, category_code, specs, approval_status from supplier_products where id = $1 and deleted_at is null for update', [input.id]);
    const allowed: Record<string, string[]> = { APPROVED: ['SUBMITTED', 'SUSPENDED'], REJECTED: ['SUBMITTED'], SUSPENDED: ['APPROVED'] };
    if (!allowed[input.decision].includes(p.approval_status)) throw new AppError('INVALID_TRANSITION');
    if (input.decision === 'APPROVED') parseSpecs(p.category_code, p.specs); // engineering attributes must be complete
    await tx.exec('update supplier_products set approval_status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now() where id = $1',
      [p.id, input.decision, input.note ?? null, ctx.userId]);
    await audit(tx, ctx, 'catalogue.product_review', 'supplier_product', p.id, { from: p.approval_status, to: input.decision, note: input.note ?? null }, p.company_id);
    await emitEvent(tx, ctx, `PRODUCT_${input.decision}`, `product-review:${p.id}:${input.decision}:${Date.now()}`, { type: 'supplier_product', id: p.id });
    await notifyCompany(tx, p.company_id, 'PRODUCT_REVIEWED', { name: p.name, status: input.decision }, '/partner/catalogue');
  });
}

export const priceReviewSchema = z.object({ id: zUuid, decision: zEnum(['APPROVED', 'REJECTED'] as const), note: zOptText(1000) });
/** Approving a price closes the previous approved price the day before the new one starts. */
export async function reviewPrice(ctx: Ctx, input: z.infer<typeof priceReviewSchema>): Promise<void> {
  requirePerm(ctx, 'catalogue.approve');
  await withCtx(ctx, async (tx) => {
    const pr = await tx.one<Rec>(
      `select pr.*, sp.name from supplier_product_prices pr join supplier_products sp on sp.id = pr.product_id where pr.id = $1 for update of pr`, [input.id]);
    if (pr.status !== 'SUBMITTED') throw new AppError('INVALID_TRANSITION');
    if ((input.decision === 'REJECTED' || pr.needs_review_reason) && !input.note) throw new AppError('REASON_REQUIRED');
    if (input.decision === 'APPROVED') {
      if (pr.valid_from < isoDateIST()) throw new AppError('PRICE_START_PASSED');
      await tx.exec(
        `update supplier_product_prices set valid_to = $3::date - 1
          where product_id = $1 and status = 'APPROVED' and id <> $2 and valid_from < $3::date and (valid_to is null or valid_to >= $3::date)`,
        [pr.product_id, pr.id, pr.valid_from]);
    }
    await tx.exec('update supplier_product_prices set status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4 where id = $1',
      [pr.id, input.decision, ctx.userId, input.note ?? null]);
    await audit(tx, ctx, 'catalogue.price_review', 'supplier_price', pr.id, { decision: input.decision, amount: pr.unit_price, change: pr.change_percent }, pr.company_id);
    await emitEvent(tx, ctx, `PRICE_${input.decision}`, `price-review:${pr.id}`, { type: 'supplier_price', id: pr.id });
    await notifyCompany(tx, pr.company_id, 'PRICE_REVIEWED', { name: pr.name, status: input.decision }, '/partner/catalogue');
  });
}

export async function getCatalogueReview(ctx: Ctx) {
  requirePerm(ctx, 'catalogue.approve', 'market.view');
  return withCtx(ctx, async (tx) => {
    const [suppliers, products, prices] = await Promise.all([
      tx.query<Rec>(
        `select c.id, c.legal_name, c.category, c.status, c.gstin, c.marketplace_status, c.marketplace_status_reason, c.is_demo,
                (select count(*) from supplier_products sp where sp.company_id = c.id and sp.approval_status = 'APPROVED' and sp.deleted_at is null) as approved_products
           from companies c where c.category in ('SUPPLIER','MANUFACTURER') order by c.legal_name`),
      tx.query<Rec>(
        `select sp.*, c.legal_name as supplier from supplier_products sp join companies c on c.id = sp.company_id
          where sp.deleted_at is null order by (sp.approval_status = 'SUBMITTED') desc, sp.updated_at desc limit 300`),
      tx.query<Rec>(
        `select pr.*, sp.name as product_name, sp.brand, sp.model, c.legal_name as supplier,
                (select p2.unit_price from supplier_product_prices p2 where p2.product_id = pr.product_id and p2.status = 'APPROVED' and p2.id <> pr.id
                  order by p2.valid_from desc limit 1) as previous_price
           from supplier_product_prices pr join supplier_products sp on sp.id = pr.product_id join companies c on c.id = pr.company_id
          where pr.status = 'SUBMITTED' order by pr.created_at`),
    ]);
    const scores = await supplierScores(tx, suppliers.map((x) => x.id));
    return { suppliers: suppliers.map((x) => ({ ...x, score: scores.get(x.id) ?? null }) as Rec), products, prices };
  });
}
