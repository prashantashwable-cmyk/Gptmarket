// Customer shopping journey (brief section 5): lift project → building and lift requirements →
// package catalogue → customisation → cart → quotation. Customers only ever receive the
// customer-facing projection of the pricing engine (see market-engine.ts).
import { z } from 'zod';
import { BUILDING_AGE, BUILDING_TYPE, LIFT_PURPOSE, POWER_SUPPLY, USAGE_FREQUENCY, type LiftCategory } from '@/lib/enums';
import { AppError } from '@/lib/errors';
import { zBool, zEnum, zNumber, zOptInt, zOptText, zText, zUuid } from '@/lib/validation';
import { audit, notifyPermission } from '../audit';
import { requireCustomer, type Ctx } from '../ctx';
import { withCtx, withSystem, type Rec, type Tx } from '../db';
import { emitEvent } from './automation';
import { saveFile } from './files';
import { createLead } from './leads';
import { customerView, evaluate, loadSpec } from './market-engine';

type Upload = { name: string; type: string; bytes: Buffer };
const MAX_CONFIGS_PER_PROJECT = 10;
const MAX_PHOTOS = 6;

export const specSchema = z.object({
  buildingAge: zEnum(BUILDING_AGE), purpose: zEnum(LIFT_PURPOSE),
  persons: zOptInt(1, 50), ratedLoadKg: zOptInt(50, 10000), speedMps: zNumber(0.1, 10).optional(),
  floors: zOptInt(1, 100), stops: zOptInt(2, 100), usageFrequency: zEnum(USAGE_FREQUENCY), accessibility: zBool,
  specialRequirements: zOptText(2000),
  shaftWidthMm: zOptInt(300, 10000), shaftDepthMm: zOptInt(300, 10000), pitDepthMm: zOptInt(0, 10000), overheadMm: zOptInt(0, 20000),
  powerSupply: zEnum(POWER_SUPPLY).default('UNKNOWN'),
});
export type SpecInput = z.infer<typeof specSchema>;

export const shopProjectSchema = specSchema.extend({
  projectName: zText(200), address: zText(500), zoneId: zUuid, buildingType: zEnum(BUILDING_TYPE),
  consentContact: zBool, consentPrivacy: zBool,
});
export type ShopProjectInput = z.infer<typeof shopProjectSchema>;

/** Number of floors alone never determines the lift: it only maps the enquiry category for the CRM. */
function liftCategoryFor(purpose: string, buildingType: string): LiftCategory {
  if (purpose === 'HOME') return 'HOME_LIFT';
  if (purpose === 'GOODS') return 'GOODS';
  if (purpose === 'HOSPITAL') return 'HOSPITAL_BED';
  return buildingType.startsWith('RESIDENTIAL') ? 'PASSENGER_RESIDENTIAL' : 'PASSENGER_COMMERCIAL';
}

async function writeSpec(tx: Tx, leadId: string, customerId: string, s: SpecInput): Promise<void> {
  await tx.exec(
    `insert into market_project_specs (lead_id, customer_id, building_age, purpose, persons, rated_load_kg, speed_mps, floors, stops, usage_frequency,
            accessibility, special_requirements, shaft_width_mm, shaft_depth_mm, pit_depth_mm, overhead_mm, power_supply)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     on conflict (lead_id) do update set building_age=excluded.building_age, purpose=excluded.purpose, persons=excluded.persons, rated_load_kg=excluded.rated_load_kg,
       speed_mps=excluded.speed_mps, floors=excluded.floors, stops=excluded.stops, usage_frequency=excluded.usage_frequency, accessibility=excluded.accessibility,
       special_requirements=excluded.special_requirements, shaft_width_mm=excluded.shaft_width_mm, shaft_depth_mm=excluded.shaft_depth_mm,
       pit_depth_mm=excluded.pit_depth_mm, overhead_mm=excluded.overhead_mm, power_supply=excluded.power_supply, updated_at=now()`,
    [leadId, customerId, s.buildingAge, s.purpose, s.persons ?? null, s.ratedLoadKg ?? null, s.speedMps ?? null, s.floors ?? null, s.stops ?? null,
      s.usageFrequency, s.accessibility, s.specialRequirements ?? null, s.shaftWidthMm ?? null, s.shaftDepthMm ?? null, s.pitDepthMm ?? null,
      s.overheadMm ?? null, s.powerSupply]);
}

function checkStops(s: SpecInput): void {
  if (s.stops !== undefined && s.floors !== undefined && s.stops > s.floors + 1) throw new AppError('VALIDATION', undefined, { stops: 'STOPS_EXCEED_FLOORS' });
}

/** "Create New Lift Project": an existing-CRM lead (consent, SLA, duplicates, survey) plus the specification and photos. */
export async function createShopProject(ctx: Ctx, input: ShopProjectInput, photos: Upload[]): Promise<string> {
  const customerId = requireCustomer(ctx);
  checkStops(input);
  if (photos.length > MAX_PHOTOS) throw new AppError('VALIDATION', undefined, { photos: 'TOO_MANY' });
  const lead = await createLead(ctx, {
    name: ctx.name, phone: ctx.phone, customerType: 'INDIVIDUAL_OWNER', projectName: input.projectName, address: input.address, zoneId: input.zoneId,
    buildingType: input.buildingType, floors: input.floors, liftCategory: liftCategoryFor(input.purpose, input.buildingType), liftCount: 1,
    timeline: 'UNDECIDED', siteReadiness: input.buildingAge === 'EXISTING' ? 'EXISTING_BUILDING' : 'UNKNOWN', financeInterest: false,
    consentContact: input.consentContact, consentPrivacy: input.consentPrivacy, referralNote: 'Created from the AIEC Lift Marketplace',
  });
  await withSystem(async (tx) => {
    await writeSpec(tx, lead.id, customerId, input);
    for (const photo of photos) {
      const fileId = await saveFile(tx, ctx, photo, 'SITE_PHOTO', { customerId });
      await tx.exec('insert into market_site_photos (lead_id, customer_id, file_id) values ($1,$2,$3)', [lead.id, customerId, fileId]);
    }
    await audit(tx, ctx, 'shop.project_create', 'lead', lead.id, { photos: photos.length });
    if (await emitEvent(tx, ctx, 'PROJECT_CREATED', `project-create:${lead.id}`, { type: 'lead', id: lead.id })) {
      await notifyPermission(tx, 'survey.schedule', 'SHOP_PROJECT_CREATED', { number: lead.leadNumber }, `/admin/leads/${lead.id}`);
    }
  });
  return lead.id;
}

export async function updateProjectSpec(ctx: Ctx, leadId: string, input: SpecInput, photos: Upload[]): Promise<void> {
  const customerId = requireCustomer(ctx);
  checkStops(input);
  await withCtx(ctx, async (tx) => {
    await tx.one('select id from leads where id = $1 and customer_id = $2', [leadId, customerId]);
    const existing = (await tx.one<{ n: number }>('select count(*) as n from market_site_photos where lead_id = $1', [leadId])).n;
    if (existing + photos.length > MAX_PHOTOS) throw new AppError('VALIDATION', undefined, { photos: 'TOO_MANY' });
    await writeSpec(tx, leadId, customerId, input);
    for (const photo of photos) {
      const fileId = await saveFile(tx, ctx, photo, 'SITE_PHOTO', { customerId });
      await tx.exec('insert into market_site_photos (lead_id, customer_id, file_id) values ($1,$2,$3)', [leadId, customerId, fileId]);
    }
    await audit(tx, ctx, 'shop.spec_update', 'lead', leadId, {});
  });
}

export async function getShopHome(ctx: Ctx) {
  const customerId = requireCustomer(ctx);
  return withCtx(ctx, async (tx) => {
    const projects = await tx.query<Rec>(
      `select l.id, l.lead_number, l.project_name, l.status, l.execution_model, l.created_at, m.purpose, m.stops,
              (select count(*) from configurations c where c.lead_id = l.id and c.status <> 'ARCHIVED') as configurations,
              (select p.status from projects p where p.lead_id = l.id) as project_status
         from leads l join market_project_specs m on m.lead_id = l.id where l.customer_id = $1 order by l.created_at desc`, [customerId]);
    const quotations = await tx.query<Rec>(
      `select q.id, q.quotation_number, q.status, q.updated_at, l.project_name, v.total_payable, v.price_basis, v.valid_until
         from market_quotations q join leads l on l.id = q.lead_id left join market_quotation_versions v on v.id = q.current_version_id
        where q.customer_id = $1 order by q.updated_at desc`, [customerId]);
    const legacy = (await tx.one<{ n: number }>(
      'select count(*) as n from leads l where l.customer_id = $1 and not exists (select 1 from market_project_specs m where m.lead_id = l.id)', [customerId])).n;
    return { projects, quotations, legacy };
  });
}

export async function getShopProject(ctx: Ctx, leadId: string) {
  const customerId = requireCustomer(ctx);
  const base = await withCtx(ctx, async (tx) => {
    const lead = await tx.one<Rec>('select l.*, z.code as zone_code from leads l join zones z on z.id = l.zone_id where l.id = $1 and l.customer_id = $2', [leadId, customerId]);
    const spec = await tx.maybeOne<Rec>('select * from market_project_specs where lead_id = $1', [leadId]);
    const photos = await tx.query<Rec>('select id, file_id, created_at from market_site_photos where lead_id = $1 order by created_at', [leadId]);
    const configurations = await tx.query<Rec>(
      `select c.*, v.title as package_title, p.code as package_code, q.id as quotation_id, q.status as quotation_status
         from configurations c join package_versions v on v.id = c.package_version_id join lift_packages p on p.id = v.package_id
         left join market_quotations q on q.configuration_id = c.id where c.lead_id = $1 and c.status <> 'ARCHIVED' order by c.created_at`, [leadId]);
    const survey = await tx.maybeOne<Rec>('select status, scheduled_at, reviewed_at from site_surveys where lead_id = $1 order by created_at desc limit 1', [leadId]);
    return { lead, spec, photos, configurations, survey };
  });
  const effective = base.spec ? await withSystem((tx) => loadSpec(tx, leadId)) : null;
  return { ...base, effective };
}

/** Published packages with technical eligibility and an estimate for this project (standard options). */
export async function getCatalogue(ctx: Ctx, leadId: string) {
  const customerId = requireCustomer(ctx);
  await withCtx(ctx, (tx) => tx.one('select 1 from market_project_specs where lead_id = $1 and customer_id = $2', [leadId, customerId]));
  return withSystem(async (tx) => {
    const versions = await tx.query<Rec>(
      `select v.id from package_versions v join lift_packages p on p.id = v.package_id where v.status = 'PUBLISHED' order by p.tier`);
    const out = [];
    for (const v of versions) {
      const view = customerView(await evaluate(tx, { leadId, packageVersionId: v.id }));
      out.push(view);
    }
    return out;
  });
}

export const startSchema = z.object({ leadId: zUuid, packageVersionId: zUuid });
export async function startConfiguration(ctx: Ctx, input: z.infer<typeof startSchema>): Promise<string> {
  const customerId = requireCustomer(ctx);
  return withCtx(ctx, async (tx) => {
    await tx.one('select 1 from market_project_specs where lead_id = $1 and customer_id = $2', [input.leadId, customerId]);
    const v = await tx.one<Rec>(`select v.id, v.title from package_versions v where v.id = $1 and v.status = 'PUBLISHED'`, [input.packageVersionId]);
    const count = (await tx.one<{ n: number }>(`select count(*) as n from configurations where lead_id = $1 and status <> 'ARCHIVED'`, [input.leadId])).n;
    if (count >= MAX_CONFIGS_PER_PROJECT) throw new AppError('TOO_MANY_CONFIGURATIONS');
    const c = await tx.one<{ id: string }>(
      `insert into configurations (customer_id, lead_id, package_version_id, name, created_by) values ($1,$2,$3,$4,$5) returning id`,
      [customerId, input.leadId, v.id, `${v.title} #${count + 1}`, ctx.userId]);
    // Every mandatory slot starts with the package's standard option.
    await tx.exec(
      `insert into configuration_items (configuration_id, slot_id, product_id)
       select $1, s.id, (select o.product_id from package_slot_options o where o.slot_id = s.id and o.kind = 'STANDARD')
         from package_slots s where s.version_id = $2 and s.is_mandatory`, [c.id, v.id]);
    await audit(tx, ctx, 'shop.configuration_start', 'configuration', c.id, { packageVersion: v.id });
    return c.id;
  });
}

async function ownConfig(tx: Tx, customerId: string, id: string): Promise<Rec> {
  return tx.one<Rec>('select * from configurations where id = $1 and customer_id = $2 for update', [id, customerId]);
}

export async function getCart(ctx: Ctx, configId: string) {
  const customerId = requireCustomer(ctx);
  const config = await withCtx(ctx, (tx) => tx.one<Rec>(
    `select c.*, l.project_name, l.lead_number, q.id as quotation_id, q.status as quotation_status
       from configurations c join leads l on l.id = c.lead_id left join market_quotations q on q.configuration_id = c.id
      where c.id = $1 and c.customer_id = $2`, [configId, customerId]));
  const view = await withSystem(async (tx) => {
    const items = await tx.query<{ slot_id: string; product_id: string | null }>('select slot_id, product_id from configuration_items where configuration_id = $1', [configId]);
    return customerView(await evaluate(tx, { leadId: config.lead_id, packageVersionId: config.package_version_id, selections: new Map(items.map((i) => [i.slot_id, i.product_id])) }));
  });
  return { config, view };
}

export const optionChangeSchema = z.object({ configId: zUuid, slotId: zUuid, productId: z.union([zUuid, z.literal('NONE')]) });
/** Changes one slot. Safety-critical and non-editable slots are rejected; mandatory slots cannot be emptied. */
export async function setCartOption(ctx: Ctx, input: z.infer<typeof optionChangeSchema>): Promise<void> {
  const customerId = requireCustomer(ctx);
  await withCtx(ctx, async (tx) => {
    const c = await ownConfig(tx, customerId, input.configId);
    if (c.status === 'ARCHIVED') throw new AppError('INVALID_TRANSITION');
    if (await tx.maybeOne(`select 1 from market_quotations where configuration_id = $1 and status = 'ACCEPTED'`, [c.id])) throw new AppError('QUOTATION_ACCEPTED');
    const slot = await tx.one<Rec>('select * from package_slots where id = $1 and version_id = $2', [input.slotId, c.package_version_id]);
    if (slot.is_safety_critical) throw new AppError('SAFETY_COMPONENT_LOCKED');
    const productId = input.productId === 'NONE' ? null : input.productId;
    if (slot.is_mandatory && !slot.customer_editable) throw new AppError('COMPONENT_NOT_CUSTOMISABLE');
    if (productId === null && slot.is_mandatory) throw new AppError('COMPONENT_REQUIRED');
    if (productId && !(await tx.maybeOne('select 1 from package_slot_options where slot_id = $1 and product_id = $2', [slot.id, productId]))) throw new AppError('OPTION_NOT_OFFERED');
    await tx.exec(
      `insert into configuration_items (configuration_id, slot_id, product_id) values ($1,$2,$3)
       on conflict (configuration_id, slot_id) do update set product_id = excluded.product_id`, [c.id, slot.id, productId]);
    await tx.exec(`update configurations set status = case when status = 'QUOTED' then 'CART' else status end, updated_at = now() where id = $1`, [c.id]);
    await audit(tx, ctx, 'shop.option_change', 'configuration', c.id, { category: slot.category_code, product: productId });
  });
}

export const configNameSchema = z.object({ configId: zUuid, name: zText(120), action: zEnum(['SAVE', 'ARCHIVE'] as const) });
export async function saveOrArchiveConfiguration(ctx: Ctx, input: z.infer<typeof configNameSchema>): Promise<void> {
  const customerId = requireCustomer(ctx);
  await withCtx(ctx, async (tx) => {
    const c = await ownConfig(tx, customerId, input.configId);
    if (input.action === 'ARCHIVE') {
      if (await tx.maybeOne(`select 1 from market_quotations where configuration_id = $1 and status = 'ACCEPTED'`, [c.id])) throw new AppError('QUOTATION_ACCEPTED');
      await tx.exec(`update configurations set status = 'ARCHIVED', updated_at = now() where id = $1`, [c.id]);
    } else {
      await tx.exec(`update configurations set name = $2, status = case when status = 'CART' then 'SAVED' else status end, updated_at = now() where id = $1`, [c.id, input.name]);
    }
    await audit(tx, ctx, `shop.configuration_${input.action.toLowerCase()}`, 'configuration', c.id, {});
  });
}

/** Side-by-side comparison of every live configuration of one project. */
export async function compareConfigurations(ctx: Ctx, leadId: string) {
  const customerId = requireCustomer(ctx);
  const configs = await withCtx(ctx, (tx) => tx.query<Rec>(
    `select id, name, config_number, package_version_id from configurations where lead_id = $1 and customer_id = $2 and status <> 'ARCHIVED' order by created_at`, [leadId, customerId]));
  return withSystem(async (tx) => {
    const out = [];
    for (const c of configs) {
      const items = await tx.query<{ slot_id: string; product_id: string | null }>('select slot_id, product_id from configuration_items where configuration_id = $1', [c.id]);
      out.push({ config: c, view: customerView(await evaluate(tx, { leadId, packageVersionId: c.package_version_id, selections: new Map(items.map((i) => [i.slot_id, i.product_id])) })) });
    }
    return out;
  });
}
