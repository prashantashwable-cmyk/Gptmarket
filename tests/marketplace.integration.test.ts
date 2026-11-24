// Marketplace integration tests against a real PostgreSQL database (TEST_DATABASE_URL, wiped).
// They exercise the shopping journey, both engines, quotation versioning and approvals, supplier
// controls and row-level security through the same services the screens use.
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv, migrate } from '../scripts/migrate';
import { DEMO_PDF, DEMO_PNG, leadInput, seedPartner, seedStaff, surveyLead, type Staff } from '../scripts/seed';
import { seedMarketplace } from '../scripts/seed-market';
import { ensureUserForPhone } from '@/server/authcore';
import { loadCtx, type Ctx } from '@/server/ctx';
import { closePool, withCtx, withSystem } from '@/server/db';
import { createLead } from '@/server/services/leads';
import { actOnPayout, createAiecOrder, getAiecFinance, getMyAiecBilling, handleRazorpayWebhook, issueCustomerInvoice, recordCustomerPayment, refundCustomerPayment, verifyCustomerPayment } from '@/server/services/aiec-contract';
import { submitCollection } from '@/server/services/money';
import { generatePurchaseOrders, getOrderPurchaseOrders, getSupplierOrders, recordSupplierPayment, staffPoAction, supplierPoAction } from '@/server/services/supplier-orders';
import { confirmOrder, getOrder, respondOrder } from '@/server/services/orders';
import { addTeamMember } from '@/server/services/partners';
import { updateMilestone } from '@/server/services/projects';
import { reviewPrice, reviewProduct, saveSupplierProduct, setSupplierStatus, submitPrice } from '@/server/services/catalogue';
import { engineeringDecision, expireMarketQuotations, getMarketQuotation, issueNewVersion, pricingExceptionDecision, requestQuotation, respondQuotation } from '@/server/services/market-quotes';
import { getMarketOverview } from '@/server/services/market-admin';
import { createPricingDraft } from '@/server/services/rules';
import { compareConfigurations, createShopProject, getCart, getCatalogue, setCartOption, startConfiguration, type ShopProjectInput } from '@/server/services/shop';
import { DEMO_PRICING } from '../scripts/seed-market';
import { isoDateIST } from '@/lib/format';

loadEnv();
const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://aiec:aiec@localhost:5432/aiec_test';
process.env.DATABASE_URL = TEST_DB;

let s: Staff;
let engineer: Ctx;
let suppliers: Ctx[];
let products: Map<string, string>;
let wakad: string;
let seq = 500;
const code = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: { code?: string; message?: string }) => e.code ?? `UNEXPECTED: ${e.message}`);
const sql = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => withSystem((tx) => tx.query<T & Record<string, unknown>>(text, params));
const uuid = () => crypto.randomUUID();

async function newCustomer(): Promise<Ctx> {
  const phone = `+9192000${String(++seq).padStart(5, '0')}`;
  await createLead(null, leadInput({ name: `Shop Customer ${seq}`, phone, projectName: `Enquiry ${seq}`, zoneId: wakad }));
  return withSystem(async (tx) => (await loadCtx(tx, await ensureUserForPhone(tx, phone, null)))!);
}
const project = (over: Partial<ShopProjectInput> = {}): ShopProjectInput => ({
  projectName: `Shop project ${++seq}`, address: 'Test address, Wakad, Pune', zoneId: wakad, buildingType: 'RESIDENTIAL_APARTMENT', buildingAge: 'NEW',
  purpose: 'PASSENGER', persons: 6, ratedLoadKg: 408, speedMps: 1, floors: 5, stops: 5, usageFrequency: 'MEDIUM', accessibility: false,
  shaftWidthMm: 1700, shaftDepthMm: 1900, pitDepthMm: 1500, overheadMm: 4200, powerSupply: 'THREE_PHASE', consentContact: true, consentPrivacy: true, ...over,
});
const versionOf = async (pkg: string) => (await sql<{ id: string }>(
  `select v.id from package_versions v join lift_packages p on p.id = v.package_id where p.code = $1 and v.status = 'PUBLISHED'`, [pkg]))[0].id;
const slotOf = async (versionId: string, category: string) => (await sql<{ id: string }>('select id from package_slots where version_id = $1 and category_code = $2', [versionId, category]))[0].id;

beforeAll(async () => {
  await migrate(TEST_DB, { reset: true, quiet: true });
  s = await seedStaff();
  await withSystem((tx) => tx.exec(`update zones set is_active = true, activated_at = now() where code in ('PUNE','PCMC','WAKAD','BANER')`));
  wakad = (await sql<{ id: string }>(`select id from zones where code = 'WAKAD'`))[0].id;
  const m = await seedMarketplace(s.admin);
  engineer = m.engineer; suppliers = m.suppliers; products = m.productIds;
});
afterAll(async () => { await closePool(); });

describe('production safety of reference data', () => {
  it('ships no prices and no active pricing rules in migrations', async () => {
    await migrate(`${TEST_DB}`, { quiet: true }); // idempotent re-run
    const demo = await sql<{ n: number }>(`select count(*)::int as n from pricing_rule_versions where not is_demo`);
    expect(demo[0].n).toBe(0);
    const draftCompat = await sql<{ status: string }>('select status from compatibility_rule_versions where version_no = 1');
    expect(draftCompat[0].status).toBe('ACTIVE'); // activated by the demo engineer in the seed, not by the migration
  });
});

describe('customer shopping journey', () => {
  let customer: Ctx; let leadId: string; let cartId: string; let standard: string;

  it('creates a lift project as a CRM lead with specification, photo and automation event', async () => {
    customer = await newCustomer();
    leadId = await createShopProject(customer, project(), [DEMO_PNG]);
    const rows = await sql<{ status: string; source: string; purpose: string; photos: number }>(
      `select l.status, l.source, m.purpose, (select count(*)::int from market_site_photos p where p.lead_id = l.id) as photos
         from leads l join market_project_specs m on m.lead_id = l.id where l.id = $1`, [leadId]);
    expect(rows[0]).toMatchObject({ status: 'NEW', source: 'CUSTOMER_APP', purpose: 'PASSENGER', photos: 1 });
    expect((await sql(`select 1 from automation_events where event_type = 'PROJECT_CREATED' and entity_id = $1`, [leadId]))).toHaveLength(1);
  });

  it('rejects more stops than the building can have', async () => {
    expect(await code(createShopProject(customer, project({ floors: 3, stops: 6 }), []))).toBe('VALIDATION');
  });

  it('lists the four packages with technical eligibility and estimates (no costs exposed)', async () => {
    const cat = await getCatalogue(customer, leadId);
    expect(cat.map((p) => p.packageVersion.code)).toEqual(['BASIC', 'STANDARD', 'PREMIUM', 'LUXURY']);
    for (const p of cat) {
      expect(p.pricingStatus).toBe('OK');
      expect(p.compat?.status).toBe('YELLOW'); // declared dimensions only
      expect(JSON.stringify(p)).not.toMatch(/unitCost|lineCost|marginAmount|priceId/);
    }
    const totals = cat.map((p) => Number(p.totals!.totalPayable));
    expect(totals[0]).toBeLessThan(totals[3]);
  });

  it('starts a cart with standard options and prices it consistently', async () => {
    standard = await versionOf('STANDARD');
    cartId = await startConfiguration(customer, { leadId, packageVersionId: standard });
    const { view } = await getCart(customer, cartId);
    const sum = Object.values(view.totals!.charges).reduce((a, v) => a + Math.round(Number(v) * 100), 0);
    expect(sum).toBe(Math.round(Number(view.totals!.sellingBeforeDiscount) * 100));
    expect(view.slots.find((x) => x.category === 'ADD_ON')!.selectedProductId).toBeNull();
  });

  it('allows approved upgrades and add-ons, and shows the upgrade charge', async () => {
    const before = Number((await getCart(customer, cartId)).view.totals!.totalPayable);
    const slot = await slotOf(standard, 'FLOORING');
    await setCartOption(customer, { configId: cartId, slotId: slot, productId: products.get('flGRN')! });
    await setCartOption(customer, { configId: cartId, slotId: await slotOf(standard, 'ADD_ON'), productId: products.get('aVA')! });
    const { view } = await getCart(customer, cartId);
    expect(Number(view.slots.find((x) => x.category === 'FLOORING')!.line!.upgradeCharge)).toBeGreaterThan(0);
    expect(Number(view.totals!.totalPayable)).toBeGreaterThan(before);
    await setCartOption(customer, { configId: cartId, slotId: await slotOf(standard, 'ADD_ON'), productId: 'NONE' });
  });

  it('never lets a customer change safety components, empty a mandatory slot or pick a product that is not offered', async () => {
    expect(await code(setCartOption(customer, { configId: cartId, slotId: await slotOf(standard, 'GOVERNOR'), productId: products.get('gv')! }))).toBe('SAFETY_COMPONENT_LOCKED');
    expect(await code(setCartOption(customer, { configId: cartId, slotId: await slotOf(standard, 'FLOORING'), productId: 'NONE' }))).toBe('COMPONENT_REQUIRED');
    expect(await code(setCartOption(customer, { configId: cartId, slotId: await slotOf(standard, 'FLOORING'), productId: products.get('flMRB')! }))).toBe('OPTION_NOT_OFFERED');
    expect(await code(setCartOption(customer, { configId: cartId, slotId: await slotOf(standard, 'MACHINE'), productId: products.get('mGL1000')! }))).toBe('COMPONENT_NOT_CUSTOMISABLE');
  });

  it('keeps other customers out of the cart', async () => {
    const other = await newCustomer();
    expect(await code(getCart(other, cartId))).toBe('NOT_FOUND');
    expect(await code(setCartOption(other, { configId: cartId, slotId: await slotOf(standard, 'FLOORING'), productId: products.get('flPVC')! }))).toBe('NOT_FOUND');
  });

  it('compares saved configurations side by side', async () => {
    await startConfiguration(customer, { leadId, packageVersionId: await versionOf('PREMIUM') });
    const cmp = await compareConfigurations(customer, leadId);
    expect(cmp).toHaveLength(2);
    expect(cmp.every((c) => c.view.totals)).toBe(true);
  });

  it('creates exactly one quotation for a duplicated request (idempotency) and an ESTIMATE on declared dimensions', async () => {
    const requestId = uuid();
    const [a, b] = await Promise.all([requestQuotation(customer, { configId: cartId, requestId }), requestQuotation(customer, { configId: cartId, requestId })]);
    expect(a.quotationId).toBe(b.quotationId);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    const versions = await sql<{ price_basis: string }>('select price_basis from market_quotation_versions where quotation_id = $1', [a.quotationId]);
    expect(versions).toEqual([{ price_basis: 'ESTIMATED' }]);
    expect((await getMarketQuotation(customer, a.quotationId)).quotation.status).toBe('ESTIMATE');
    expect(await code(respondQuotation(customer, { id: a.quotationId, decision: 'ACCEPT', executionModel: 'MARKETPLACE', termsAccepted: true }))).toBe('QUOTATION_NOT_ISSUED');
  });

  it('never shows internal costs to the customer, even through direct queries under row-level security', async () => {
    const q = (await sql<{ id: string }>('select id from market_quotations where configuration_id = $1', [cartId]))[0];
    const view = await getMarketQuotation(customer, q.id);
    expect(view.costs).toEqual([]);
    const leaked = await withCtx(customer, async (tx) => ({
      costs: await tx.query('select * from market_quotation_costs'),
      prices: await tx.query('select * from supplier_product_prices'),
      rules: await tx.query('select * from pricing_rule_versions'),
    }));
    expect(leaked).toEqual({ costs: [], prices: [], rules: [] });
  });
});

describe('engineering validation, approvals and acceptance', () => {
  let customer: Ctx; let leadId: string; let cartId: string; let quotationId: string;

  it('blocks a RED (incompatible) configuration from being quoted', async () => {
    const c = await newCustomer();
    const lead = await createShopProject(c, project({ powerSupply: 'SINGLE_PHASE' }), []);
    const cart = await startConfiguration(c, { leadId: lead, packageVersionId: await versionOf('BASIC') });
    const { view } = await getCart(c, cart);
    expect(view.compat!.status).toBe('RED');
    expect(view.compat!.findings.map((f) => f.code)).toContain('POWER_THREE_PHASE_REQUIRED');
    expect(await code(requestQuotation(c, { configId: cart, requestId: uuid() }))).toBe('CONFIG_INCOMPATIBLE');
  });

  it('issues a FINAL version after the AIEC survey; it waits for the engineer', async () => {
    customer = await newCustomer();
    leadId = await createShopProject(customer, project({ powerSupply: 'UNKNOWN' }), []);
    await surveyLead(s, leadId, 5);
    cartId = await startConfiguration(customer, { leadId, packageVersionId: await versionOf('BASIC') });
    quotationId = (await requestQuotation(customer, { configId: cartId, requestId: uuid() })).quotationId;
    const q = await getMarketQuotation(s.ops, quotationId);
    expect(q.quotation.status).toBe('PENDING_ENGINEERING');
    expect(q.current!.price_basis).toBe('FINAL');
    expect(q.current!.compat_status).toBe('YELLOW');
    expect(q.costs).toHaveLength(1);
  });

  it('allows only an authorised engineer to decide, and only with every YELLOW finding acknowledged', async () => {
    const versionId = (await getMarketQuotation(s.ops, quotationId)).current!.id;
    expect(await code(engineeringDecision(s.ops, { versionId, decision: 'APPROVED', note: 'ok', acknowledged: [] }))).toBe('FORBIDDEN');
    expect(await code(engineeringDecision(customer, { versionId, decision: 'APPROVED', note: 'ok', acknowledged: [] }))).toBe('FORBIDDEN');
    expect(await code(engineeringDecision(engineer, { versionId, decision: 'APPROVED', note: 'Checked', acknowledged: [] }))).toBe('FINDINGS_NOT_ACKNOWLEDGED');
  });

  it('requires owner approval for a discount above the limit', async () => {
    const versionId = await issueNewVersion(s.ops, { id: quotationId, discountPercent: '6', discountReason: 'Society bulk order' });
    const q = await getMarketQuotation(s.ops, quotationId);
    expect(q.current!.id).toBe(versionId);
    expect(q.current!.version_no).toBe(2);
    expect(q.current!.needs_owner_approval).toBe(true);
    expect(q.costs.find((c) => c.version_id === versionId)!.exceptions).toEqual(expect.arrayContaining(['DISCOUNT_ABOVE_LIMIT']));
    await engineeringDecision(engineer, { versionId, decision: 'APPROVED', note: 'Three-phase supply to be confirmed on site', acknowledged: ['POWER_SUPPLY_UNKNOWN'] });
    expect((await getMarketQuotation(s.ops, quotationId)).quotation.status).toBe('PENDING_OWNER_APPROVAL');
    expect(await code(pricingExceptionDecision(s.ops, { versionId, decision: 'APPROVED', note: 'ok' }))).toBe('FORBIDDEN');
    await pricingExceptionDecision(s.admin, { versionId, decision: 'APPROVED', note: 'Approved for a 12-flat society' });
    expect((await getMarketQuotation(s.ops, quotationId)).quotation.status).toBe('ISSUED');
    const approvals = await sql<{ kind: string; decision: string }>('select kind, decision from market_quotation_approvals where version_id = $1 order by kind', [versionId]);
    expect(approvals).toEqual([{ kind: 'ENGINEERING', decision: 'APPROVED' }, { kind: 'PRICING_EXCEPTION', decision: 'APPROVED' }]);
  });

  it('never changes an issued quotation when the supplier price changes', async () => {
    const before = (await getMarketQuotation(s.ops, quotationId)).current!;
    const machine = products.get('mGL630')!;
    const p = await submitPrice(suppliers[1], { productId: machine, unitPrice: '180000', validFrom: isoDateIST(), note: 'Steel price increase' });
    expect(p.flagged).toBe(false);
    expect(await code(reviewPrice(s.ops, { id: p.id, decision: 'APPROVED' }))).toBe('NO_ERROR');
    const after = (await getMarketQuotation(s.ops, quotationId)).current!;
    expect(after.id).toBe(before.id);
    expect(after.total_payable).toBe(before.total_payable);
    // the cart, however, shows today's approved price
    const cart = await getCart(customer, cartId);
    expect(Number(cart.view.totals!.sellingBeforeDiscount)).toBeGreaterThan(Number(before.selling_before_discount));
  });

  it('refuses database edits of a quotation version, a published package or active rules', async () => {
    const v = (await getMarketQuotation(s.ops, quotationId)).current!;
    expect(await code(withSystem((tx) => tx.exec('update market_quotation_versions set total_payable = 1 where id = $1', [v.id])))).toBe('FORBIDDEN');
    expect(await code(withSystem((tx) => tx.exec(`update package_versions set title = 'Changed' where status = 'PUBLISHED'`)))).toBe('PACKAGE_LOCKED');
    expect(await code(withSystem((tx) => tx.exec(`update pricing_rule_versions set params = '{}' where status = 'ACTIVE'`)))).toBe('RULES_LOCKED');
    expect(await code(withSystem((tx) => tx.exec(`update supplier_product_prices set unit_price = 1 where status = 'APPROVED'`)))).toBe('FORBIDDEN');
  });

  it('blocks acceptance while a quoted supplier is suspended, and the open cart turns RED', async () => {
    const supplierId = (await sql<{ company_id: string }>('select company_id from supplier_products where id = $1', [products.get('mGL630')!]))[0].company_id;
    expect(await code(setSupplierStatus(s.ops, { companyId: supplierId, status: 'SUSPENDED' }))).toBe('REASON_REQUIRED');
    await setSupplierStatus(s.ops, { companyId: supplierId, status: 'SUSPENDED', reason: 'Late deliveries under review' });
    expect(await code(respondQuotation(customer, { id: quotationId, decision: 'ACCEPT', executionModel: 'MARKETPLACE', termsAccepted: true }))).toBe('SUPPLIER_NO_LONGER_APPROVED');
    const cart = await getCart(customer, cartId);
    expect(cart.view.compat!.status).toBe('RED');
    expect(cart.view.compat!.findings.map((f) => f.code)).toContain('PRODUCT_NOT_ELIGIBLE');
    expect((await getMarketOverview(s.admin)).exceptions.map((e) => e.kind)).toContain('quotesIneligible');
    await setSupplierStatus(s.ops, { companyId: supplierId, status: 'APPROVED' });
  });

  it('accepts only with an execution model and the terms, once', async () => {
    expect(await code(respondQuotation(customer, { id: quotationId, decision: 'ACCEPT', termsAccepted: true }))).toBe('VALIDATION');
    expect(await code(respondQuotation(customer, { id: quotationId, decision: 'ACCEPT', executionModel: 'AIEC_CONTRACT', termsAccepted: false }))).toBe('VALIDATION');
    await respondQuotation(customer, { id: quotationId, decision: 'ACCEPT', executionModel: 'AIEC_CONTRACT', termsAccepted: true });
    const lead = await sql<{ execution_model: string }>('select execution_model from leads where id = $1', [leadId]);
    expect(lead[0].execution_model).toBe('AIEC_CONTRACT');
    const q = await getMarketQuotation(customer, quotationId);
    expect(q.quotation.status).toBe('ACCEPTED');
    expect(q.quotation.accepted_version_id).toBe(q.current!.id);
    expect(await code(respondQuotation(customer, { id: quotationId, decision: 'ACCEPT', executionModel: 'AIEC_CONTRACT', termsAccepted: true }))).toBe('QUOTATION_NOT_ISSUED');
    expect(await code(setCartOption(customer, { configId: cartId, slotId: await slotOf(await versionOf('BASIC'), 'FLOORING'), productId: products.get('flGRN')! }))).toBe('QUOTATION_ACCEPTED');
    const audits = await sql<{ action: string }>(`select action from audit_logs where entity_id = $1 order by created_at`, [quotationId]);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['market_quotation.version', 'market_quotation.engineering', 'market_quotation.pricing_exception', 'market_quotation.accept']));
  });

  it('expires quotations after their validity date and refuses to accept them', async () => {
    const c = await newCustomer();
    const lead = await createShopProject(c, project(), []);
    await surveyLead(s, lead, 5);
    const cart = await startConfiguration(c, { leadId: lead, packageVersionId: await versionOf('BASIC') });
    const id = (await requestQuotation(c, { configId: cart, requestId: uuid() })).quotationId;
    const v = (await getMarketQuotation(s.ops, id)).current!;
    await engineeringDecision(engineer, { versionId: v.id, decision: 'APPROVED', note: 'Survey checked', acknowledged: [] });
    await withSystem(async (tx) => {
      await tx.exec('alter table market_quotation_versions disable trigger market_quotation_versions_immutable');
      await tx.exec(`update market_quotation_versions set valid_until = current_date - 1 where id = $1`, [v.id]);
      await tx.exec('alter table market_quotation_versions enable trigger market_quotation_versions_immutable');
    });
    expect(await code(respondQuotation(c, { id, decision: 'ACCEPT', executionModel: 'MARKETPLACE', termsAccepted: true }))).toBe('QUOTATION_EXPIRED');
    expect(await withSystem((tx) => expireMarketQuotations(tx))).toBeGreaterThanOrEqual(1);
    expect((await getMarketQuotation(c, id)).quotation.status).toBe('EXPIRED');
  });
});

describe('supplier marketplace controls', () => {
  it('keeps supplier drafts private to the supplier and requires complete specifications for approval', async () => {
    const [mine, other] = suppliers;
    const id = await saveSupplierProduct(mine, {
      categoryCode: 'FLOORING', brand: 'Test', model: 'T-1', name: 'Test flooring', priceUnit: 'EACH', warrantyMonths: 12, deliveryDays: 7, stockQty: 3,
    }, {}, { image: null, document: null });
    expect(await withCtx(other, (tx) => tx.query('select id from supplier_products where id = $1', [id]))).toEqual([]);
    expect(await code(reviewProduct(s.ops, { id, decision: 'APPROVED' }))).toBe('INVALID_TRANSITION'); // still a draft
    expect(await code(reviewProduct(mine, { id, decision: 'APPROVED' }))).toBe('FORBIDDEN');
    expect(await code(saveSupplierProduct(mine, { categoryCode: 'MACHINE', brand: 'X', model: 'X-1', name: 'Incomplete motor', priceUnit: 'EACH', warrantyMonths: 12, deliveryDays: 7, stockQty: 1 },
      { maxLoadKg: 630 }, { image: null, document: null }))).toBe('VALIDATION');
  });

  it('flags a large price jump and insists on a reviewer note', async () => {
    const p = await submitPrice(suppliers[0], { productId: products.get('flPVC')!, unitPrice: '60000', validFrom: isoDateIST() });
    expect(p.flagged).toBe(true);
    expect(await code(reviewPrice(s.ops, { id: p.id, decision: 'APPROVED' }))).toBe('REASON_REQUIRED');
    await reviewPrice(s.ops, { id: p.id, decision: 'REJECTED', note: 'Typing error: 10x the previous price' });
    expect(await code(submitPrice(suppliers[0], { productId: products.get('flPVC')!, unitPrice: '0', validFrom: isoDateIST() }))).toBe('VALIDATION');
  });

  it('lets only pricing roles create rules', async () => {
    const customer = await newCustomer();
    expect(await code(createPricingDraft(customer, DEMO_PRICING, null))).toBe('FORBIDDEN');
    expect(await code(createPricingDraft(suppliers[0], DEMO_PRICING, null))).toBe('FORBIDDEN');
  });
});

describe('AIEC Contract execution: order, invoices, payments, refunds, payouts', () => {
  let customer: Ctx; let leadId: string; let quotationId: string; let orderId: string; let projectId: string;
  let partner: { companyId: string; ctx: Ctx }; let farPartner: { companyId: string; ctx: Ctx };
  let milestones: Array<{ id: string; amount_due: string; seq: number }>;

  it('prepares an accepted AIEC Contract quotation and two partners', async () => {
    partner = await seedPartner(s.admin, { legalName: 'AIEC Execution Partner', adminName: 'Exec Admin', adminPhone: '+919300000011', pan: 'AAACX1111X', zones: ['WAKAD', 'PUNE'], maxProjects: 3 });
    farPartner = await seedPartner(s.admin, { legalName: 'Far Away Partner', adminName: 'Far Admin', adminPhone: '+919300000012', pan: 'AAACY2222Y', zones: ['CHAKAN'], maxProjects: 3 });
    await addTeamMember(partner.ctx, { name: 'Exec Supervisor', phone: '+919300000021', role: 'PARTNER_SUPERVISOR' });
    customer = await newCustomer();
    leadId = await createShopProject(customer, project(), []);
    await surveyLead(s, leadId, 5);
    const cart = await startConfiguration(customer, { leadId, packageVersionId: await versionOf('BASIC') });
    quotationId = (await requestQuotation(customer, { configId: cart, requestId: uuid() })).quotationId;
    const v = (await getMarketQuotation(s.ops, quotationId)).current!;
    await engineeringDecision(engineer, { versionId: v.id, decision: 'APPROVED', note: 'Survey checked', acknowledged: [] });
    await respondQuotation(customer, { id: quotationId, decision: 'ACCEPT', executionModel: 'AIEC_CONTRACT', termsAccepted: true });
  });

  const orderInput = (over: Record<string, unknown> = {}) => ({
    quotationId, companyId: partner.companyId, partnerPayoutValue: '150000', contractReference: 'AIEC-CTR-001', contractAcceptedOn: isoDateIST(),
    approvalPathNote: 'Partner applies for erection permission; AIEC tracks inspection.', ...over,
  });

  it('refuses a partner outside the zone and a payout that would leave AIEC below its material cost', async () => {
    expect(await code(createAiecOrder(s.ops, orderInput({ companyId: farPartner.companyId }), null))).toBe('PARTNER_ZONE');
    expect(await code(createAiecOrder(s.ops, orderInput({ partnerPayoutValue: '99999999' }), null))).toBe('PAYOUT_EXCEEDS_BUDGET');
    expect(await code(createAiecOrder(customer, orderInput(), null))).toBe('FORBIDDEN');
  });

  it('creates the order once, moves the lead to order pending and carries no commission', async () => {
    orderId = await createAiecOrder(s.ops, orderInput(), DEMO_PDF);
    expect(await code(createAiecOrder(s.ops, orderInput(), null))).toBe('ORDER_EXISTS');
    const o = (await sql<{ execution_model: string; eligible_value: string | null; gross_order_value: string; status: string }>(
      'select execution_model, eligible_value, gross_order_value::text, status from orders where id = $1', [orderId]))[0];
    const q = (await getMarketQuotation(s.ops, quotationId)).current!;
    expect(o).toMatchObject({ execution_model: 'AIEC_CONTRACT', eligible_value: null, status: 'PENDING_PARTNER_ACCEPTANCE', gross_order_value: q.total_payable });
    expect((await sql<{ status: string }>('select status from leads where id = $1', [leadId]))[0].status).toBe('ORDER_PENDING');
  });

  it('confirms through the standard checklist and freezes the quotation milestones and partner payouts', async () => {
    const sup = (await sql<{ user_id: string }>(`select user_id from user_roles where company_id = $1 and role_code = 'PARTNER_SUPERVISOR'`, [partner.companyId]))[0].user_id;
    await respondOrder(partner.ctx, { id: orderId, decision: 'accept', supervisorUserId: sup });
    projectId = await confirmOrder(s.ops, orderId);
    milestones = await sql('select id, amount_due::text, seq from project_milestones where project_id = $1 order by seq', [projectId]);
    expect(milestones).toHaveLength(4);
    const gross = (await sql<{ g: string }>('select gross_order_value::text as g from orders where id = $1', [orderId]))[0].g;
    expect(milestones.reduce((a, m) => a + Math.round(Number(m.amount_due) * 100), 0)).toBe(Math.round(Number(gross) * 100));
    const payouts = await sql<{ amount: string }>('select amount::text from partner_payouts where order_id = $1', [orderId]);
    expect(payouts.reduce((a, p) => a + Math.round(Number(p.amount) * 100), 0)).toBe(15000000);
    expect((await sql<{ status: string }>('select status from leads where id = $1', [leadId]))[0].status).toBe('CONFIRMED');
    // The engaged partner sees the order scope and milestone schedule, but not the package quotation itself.
    const seen = await getOrder(partner.ctx, orderId);
    expect(seen.milestones).toHaveLength(4);
    expect(seen.order.quotation_number).toMatch(/^MQ-/);
    expect(await withCtx(partner.ctx, (tx) => tx.query('select * from market_quotation_versions'))).toEqual([]);
  });

  it('does not let the partner record customer collections on an AIEC Contract project', async () => {
    expect(await code(submitCollection(partner.ctx, { projectId, milestoneId: milestones[0].id, amountReceived: '1000', excludedAmount: '0', collectionDate: isoDateIST(),
      paymentMode: 'BANK_TRANSFER', bankReference: 'UTR-X', evidenceKind: 'BANK_PROOF' } as Parameters<typeof submitCollection>[1], DEMO_PDF))).toBe('COLLECTION_NOT_APPLICABLE');
  });

  let invoiceId: string;
  it('issues one GST invoice per milestone', async () => {
    invoiceId = await issueCustomerInvoice(s.ops, { milestoneId: milestones[0].id, dueDays: 7 });
    expect(await code(issueCustomerInvoice(s.ops, { milestoneId: milestones[0].id, dueDays: 7 }))).toBe('INVOICE_EXISTS');
    const inv = (await sql<{ taxable_amount: string; gst_amount: string; total_amount: string }>('select taxable_amount::text, gst_amount::text, total_amount::text from customer_invoices where id = $1', [invoiceId]))[0];
    expect(inv.total_amount).toBe(milestones[0].amount_due);
    expect(Math.round(Number(inv.taxable_amount) * 100) + Math.round(Number(inv.gst_amount) * 100)).toBe(Math.round(Number(inv.total_amount) * 100));
    expect(Math.abs(Number(inv.gst_amount) - Number(inv.taxable_amount) * 0.18)).toBeLessThan(0.02);
  });

  it('verifies payments only through finance staff, with maker-checker, and never over the invoice', async () => {
    const inv = (await sql<{ total_amount: string }>('select total_amount::text from customer_invoices where id = $1', [invoiceId]))[0];
    expect(await code(recordCustomerPayment(customer, { invoiceId, amount: String(Number(inv.total_amount) + 1), paymentMode: 'UPI', reference: 'UPI-OVER', paidOn: isoDateIST() }))).toBe('AMOUNT_EXCEEDS');
    const claim = await recordCustomerPayment(customer, { invoiceId, amount: inv.total_amount, paymentMode: 'UPI', reference: 'UPI-REF-0001', paidOn: isoDateIST() });
    expect(await code(verifyCustomerPayment(customer, { id: claim, decision: 'VERIFIED' }))).toBe('FORBIDDEN');
    expect((await sql<{ status: string }>('select status from customer_invoices where id = $1', [invoiceId]))[0].status).toBe('ISSUED');
    await verifyCustomerPayment(s.ops, { id: claim, decision: 'VERIFIED', note: 'Matched bank statement' });
    expect((await sql<{ status: string }>('select status from customer_invoices where id = $1', [invoiceId]))[0].status).toBe('PAID');
    const inv2 = await issueCustomerInvoice(s.ops, { milestoneId: milestones[1].id, dueDays: 7 });
    const staffClaim = await recordCustomerPayment(s.ops, { invoiceId: inv2, amount: '1000', paymentMode: 'BANK_TRANSFER', reference: 'NEFT-0001', paidOn: isoDateIST() });
    expect(await code(verifyCustomerPayment(s.ops, { id: staffClaim, decision: 'VERIFIED' }))).toBe('SAME_PERSON_VERIFY');
    await verifyCustomerPayment(s.admin, { id: staffClaim, decision: 'VERIFIED' });
    expect((await sql<{ status: string }>('select status from customer_invoices where id = $1', [inv2]))[0].status).toBe('PARTLY_PAID');
  });

  it('handles refunds and keeps invoice amounts immutable', async () => {
    const pay = (await sql<{ id: string; amount: string }>(`select id, amount::text from customer_payments where invoice_id = $1 and status = 'VERIFIED'`, [invoiceId]))[0];
    expect(await code(refundCustomerPayment(s.ops, { paymentId: pay.id, amount: String(Number(pay.amount) + 1), reason: 'Too much' }))).toBe('VALIDATION');
    await refundCustomerPayment(s.ops, { paymentId: pay.id, amount: '5000', reason: 'Customer removed an add-on', reference: 'RFND-1' });
    expect((await sql<{ status: string }>('select status from customer_invoices where id = $1', [invoiceId]))[0].status).toBe('PARTLY_PAID');
    expect(await code(withSystem((tx) => tx.exec('update customer_invoices set total_amount = 1 where id = $1', [invoiceId])))).toBe('FORBIDDEN');
  });

  it('releases a partner payout only to the owner, after the milestone is completed, and pays it with a reference', async () => {
    const po = (await sql<{ id: string }>('select id from partner_payouts where milestone_id = $1', [milestones[0].id]))[0].id;
    expect(await code(actOnPayout(s.ops, { id: po, action: 'APPROVE' }))).toBe('FORBIDDEN');
    expect(await code(actOnPayout(s.admin, { id: po, action: 'APPROVE' }))).toBe('MILESTONE_NOT_COMPLETED');
    await updateMilestone(partner.ctx, { id: milestones[0].id, status: 'COMPLETED' });
    await actOnPayout(s.admin, { id: po, action: 'APPROVE' });
    expect(await code(actOnPayout(s.admin, { id: po, action: 'PAID' }))).toBe('VALIDATION');
    await actOnPayout(s.admin, { id: po, action: 'PAID', reference: 'PAYOUT-UTR-1', paidOn: isoDateIST() });
    const f = await getAiecFinance(partner.ctx, orderId);
    expect(f!.payouts.find((p) => p.id === po)!.status).toBe('PAID');
    expect(f!.invoices).toEqual([]);
    expect(await withCtx(partner.ctx, (tx) => tx.query('select * from customer_payments'))).toEqual([]);
  });

  it('verifies Razorpay webhooks by signature, records the payment once and refuses until configured', async () => {
    const inv3 = await issueCustomerInvoice(s.ops, { milestoneId: milestones[2].id, dueDays: 7 });
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_TEST123', amount: 100000, currency: 'INR', notes: { invoice_id: inv3 } } } } });
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    expect(await code(handleRazorpayWebhook(body, 'x', 'evt_1'))).toBe('GATEWAY_NOT_CONFIGURED');
    process.env.RAZORPAY_WEBHOOK_SECRET = 'test-razorpay-secret';
    expect(await code(handleRazorpayWebhook(body, 'bad', 'evt_1'))).toBe('FORBIDDEN');
    const sig = createHmac('sha256', 'test-razorpay-secret').update(body).digest('hex');
    expect(await handleRazorpayWebhook(body, sig, 'evt_1')).toEqual({ status: 'processed' });
    expect(await handleRazorpayWebhook(body, sig, 'evt_1')).toEqual({ status: 'duplicate' });
    expect(await handleRazorpayWebhook(body, sig, 'evt_2')).toEqual({ status: 'duplicate' });
    const rows = await sql<{ status: string; amount: string; verification_basis: string }>('select status, amount::text, verification_basis from customer_payments where invoice_id = $1', [inv3]);
    expect(rows).toEqual([{ status: 'VERIFIED', amount: '1000.00', verification_basis: 'GATEWAY_WEBHOOK' }]);
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  it('issues one purchase order per supplier from the frozen costs, once', async () => {
    expect(await generatePurchaseOrders(s.ops, orderId)).toBe(2);
    expect(await generatePurchaseOrders(s.ops, orderId)).toBe(0);
    const pos = (await getOrderPurchaseOrders(s.ops, orderId))!;
    expect(pos).toHaveLength(2);
    const material = (await sql<{ m: string }>(
      'select c.material_cost::text as m from orders o join market_quotation_costs c on c.version_id = o.market_quotation_version_id where o.id = $1', [orderId]))[0].m;
    expect(pos.reduce((a, p) => a + Math.round(Number(p.total_cost) * 100), 0)).toBe(Math.round(Number(material) * 100));
    expect(await code(generatePurchaseOrders(customer, orderId))).toBe('FORBIDDEN');
  });

  it('lets each supplier see only its purchase order, acknowledge and dispatch it, and notifies operations', async () => {
    const [bhima, indrayani] = suppliers;
    const mine = await getSupplierOrders(bhima);
    expect(mine.orders).toHaveLength(1);
    expect(mine.orders[0].delivery_address).toContain('Wakad');
    const po = mine.orders[0];
    expect(await code(supplierPoAction(indrayani, { id: po.id, action: 'ACKNOWLEDGE', expectedDelivery: isoDateIST() }))).toBe('NOT_FOUND');
    expect(await code(supplierPoAction(bhima, { id: po.id, action: 'DISPATCH' }))).toBe('VALIDATION');
    await supplierPoAction(bhima, { id: po.id, action: 'ACKNOWLEDGE', expectedDelivery: isoDateIST() });
    await supplierPoAction(bhima, { id: po.id, action: 'DISPATCH', reference: 'LR-12345' });
    expect((await sql(`select 1 from automation_events where event_type = 'MATERIAL_DISPATCHED' and idempotency_key = $1`, [`po-dispatch:${po.id}`]))).toHaveLength(1);
    await staffPoAction(s.ops, { id: po.id, action: 'DELIVERED' });
    expect((await getSupplierOrders(bhima)).orders[0].status).toBe('DELIVERED');
    expect(await code(withSystem((tx) => tx.exec('update supplier_purchase_orders set total_cost = 1 where id = $1', [po.id])))).toBe('FORBIDDEN');
  });

  it('records supplier payments by the owner only and never above the purchase order', async () => {
    const po = (await getSupplierOrders(suppliers[0])).orders[0];
    expect(await code(recordSupplierPayment(s.ops, { poId: po.id, amount: '1000', reference: 'NEFT-SUP-1', paidOn: isoDateIST() }))).toBe('FORBIDDEN');
    expect(await code(recordSupplierPayment(s.admin, { poId: po.id, amount: String(Number(po.total_cost) + 1), reference: 'NEFT-SUP-X', paidOn: isoDateIST() }))).toBe('AMOUNT_EXCEEDS');
    await recordSupplierPayment(s.admin, { poId: po.id, amount: '1000', reference: 'NEFT-SUP-1', paidOn: isoDateIST() });
    const ledger = (await getSupplierOrders(suppliers[0])).ledger;
    expect(ledger.paid).toBe('1000.00');
    expect(Math.round(Number(ledger.outstanding) * 100)).toBe(Math.round(Number(po.total_cost) * 100) - 100000);
  });

  it('shows the customer only their own invoices and payments', async () => {
    const mine = await getMyAiecBilling(customer, leadId);
    expect(mine.invoices.length).toBe(3);
    const other = await newCustomer();
    expect((await getMyAiecBilling(other, leadId)).invoices).toEqual([]);
  });
});
