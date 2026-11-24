// Marketplace integration tests against a real PostgreSQL database (TEST_DATABASE_URL, wiped).
// They exercise the shopping journey, both engines, quotation versioning and approvals, supplier
// controls and row-level security through the same services the screens use.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv, migrate } from '../scripts/migrate';
import { DEMO_PNG, leadInput, seedStaff, surveyLead, type Staff } from '../scripts/seed';
import { seedMarketplace } from '../scripts/seed-market';
import { ensureUserForPhone } from '@/server/authcore';
import { loadCtx, type Ctx } from '@/server/ctx';
import { closePool, withCtx, withSystem } from '@/server/db';
import { createLead } from '@/server/services/leads';
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
