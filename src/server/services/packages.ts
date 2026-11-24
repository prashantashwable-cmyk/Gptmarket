// Ready-made lift packages (brief section 5, screen 4) and their immutable published versions.
import { z } from 'zod';
import { compatParamsSchema, DEFAULT_COMPAT_PARAMS } from '@/lib/compatibility';
import { COMPONENT_CATEGORY, LIFT_PURPOSE, OPTION_KIND, SAFETY_CRITICAL_CATEGORIES, type ComponentCategory } from '@/lib/enums';
import { AppError } from '@/lib/errors';
import { zBool, zEnum, zInt, zNumber, zOptText, zText, zUuid } from '@/lib/validation';
import { audit } from '../audit';
import { requirePerm, type Ctx } from '../ctx';
import { withCtx, type Rec, type Tx } from '../db';
import { emitEvent } from './automation';

export async function listPackagesAdmin(ctx: Ctx) {
  requirePerm(ctx, 'package.manage', 'market.view');
  return withCtx(ctx, async (tx) => {
    const packages = await tx.query<Rec>('select * from lift_packages order by tier');
    const versions = await tx.query<Rec>(
      `select v.*, (select count(*) from package_slots s where s.version_id = v.id) as slots from package_versions v order by v.package_id, v.version_no desc`);
    return packages.map((p) => ({ ...p, versions: versions.filter((v) => v.package_id === p.id) }) as Rec);
  });
}

export async function getPackageVersionAdmin(ctx: Ctx, versionId: string) {
  requirePerm(ctx, 'package.manage', 'market.view');
  return withCtx(ctx, async (tx) => {
    const version = await tx.one<Rec>('select v.*, p.code, p.tier from package_versions v join lift_packages p on p.id = v.package_id where v.id = $1', [versionId]);
    const slots = await tx.query<Rec>('select * from package_slots where version_id = $1 order by sort, category_code', [versionId]);
    const options = await tx.query<Rec>(
      `select o.*, sp.name, sp.brand, sp.model, sp.approval_status, c.legal_name as supplier, c.marketplace_status
         from package_slot_options o join package_slots s on s.id = o.slot_id join supplier_products sp on sp.id = o.product_id
         join companies c on c.id = sp.company_id where s.version_id = $1 order by o.kind, sp.name`, [versionId]);
    const candidates = await tx.query<Rec>(
      `select sp.id, sp.category_code, sp.name, sp.brand, sp.model, c.legal_name as supplier from supplier_products sp join companies c on c.id = sp.company_id
        where sp.approval_status = 'APPROVED' and sp.deleted_at is null and c.marketplace_status in ('APPROVED','PREFERRED') order by sp.category_code, sp.name`);
    return { version, slots: slots.map((s) => ({ ...s, options: options.filter((o) => o.slot_id === s.id) }) as Rec), candidates };
  });
}

/** Starts a new draft as a copy of the latest version (or empty), never editing a published one. */
export async function createPackageDraft(ctx: Ctx, packageId: string): Promise<string> {
  requirePerm(ctx, 'package.manage');
  return withCtx(ctx, async (tx) => {
    const pkg = await tx.one<Rec>('select * from lift_packages where id = $1 for update', [packageId]);
    if (await tx.maybeOne('select 1 from package_versions where package_id = $1 and status = \'DRAFT\'', [packageId])) throw new AppError('DRAFT_EXISTS');
    const prev = await tx.maybeOne<Rec>('select * from package_versions where package_id = $1 order by version_no desc limit 1', [packageId]);
    const next = (prev?.version_no ?? 0) + 1;
    const row = await tx.one<{ id: string }>(
      `insert into package_versions (package_id, version_no, title, summary, features, exclusions, warranty_months, eligible_purposes,
              min_stops, max_stops, max_speed_mps, min_load_kg, max_load_kg, image_file_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [packageId, next, prev?.title ?? `AIEC ${pkg.code[0]}${pkg.code.slice(1).toLowerCase()}`, prev?.summary ?? null, prev?.features ?? null,
        prev?.exclusions ?? null, prev?.warranty_months ?? 12, prev?.eligible_purposes ?? ['PASSENGER'], prev?.min_stops ?? 2, prev?.max_stops ?? 10,
        prev?.max_speed_mps ?? 1.0, prev?.min_load_kg ?? 100, prev?.max_load_kg ?? 1000, prev?.image_file_id ?? null, ctx.userId]);
    if (prev) {
      const slots = await tx.query<Rec>('select * from package_slots where version_id = $1', [prev.id]);
      for (const s of slots) {
        const ns = await tx.one<{ id: string }>(
          'insert into package_slots (version_id, category_code, is_mandatory, is_safety_critical, customer_editable, sort) values ($1,$2,$3,$4,$5,$6) returning id',
          [row.id, s.category_code, s.is_mandatory, s.is_safety_critical, s.customer_editable, s.sort]);
        await tx.exec('insert into package_slot_options (slot_id, product_id, kind) select $1, product_id, kind from package_slot_options where slot_id = $2', [ns.id, s.id]);
      }
    }
    await audit(tx, ctx, 'package.draft', 'package_version', row.id, { package: pkg.code, version: next });
    return row.id;
  });
}

async function draftOf(tx: Tx, versionId: string): Promise<Rec> {
  const v = await tx.one<Rec>('select * from package_versions where id = $1 for update', [versionId]);
  if (v.status !== 'DRAFT') throw new AppError('PACKAGE_LOCKED');
  return v;
}

export const packageVersionSchema = z.object({
  id: zUuid, title: zText(120), summary: zOptText(1000), features: zOptText(3000), exclusions: zOptText(3000),
  warrantyMonths: zInt(0, 240), eligiblePurposes: z.array(zEnum(LIFT_PURPOSE)).min(1, 'REQUIRED'),
  minStops: zInt(2, 100), maxStops: zInt(2, 100), maxSpeedMps: zNumber(0.1, 10), minLoadKg: zInt(50, 20000), maxLoadKg: zInt(50, 20000),
});
export async function updatePackageVersion(ctx: Ctx, input: z.infer<typeof packageVersionSchema>): Promise<void> {
  requirePerm(ctx, 'package.manage');
  if (input.maxStops < input.minStops) throw new AppError('VALIDATION', undefined, { maxStops: 'INVALID' });
  if (input.maxLoadKg < input.minLoadKg) throw new AppError('VALIDATION', undefined, { maxLoadKg: 'INVALID' });
  await withCtx(ctx, async (tx) => {
    await draftOf(tx, input.id);
    await tx.exec(
      `update package_versions set title=$2, summary=$3, features=$4, exclusions=$5, warranty_months=$6, eligible_purposes=$7, min_stops=$8, max_stops=$9,
              max_speed_mps=$10, min_load_kg=$11, max_load_kg=$12 where id=$1`,
      [input.id, input.title, input.summary ?? null, input.features ?? null, input.exclusions ?? null, input.warrantyMonths, input.eligiblePurposes,
        input.minStops, input.maxStops, input.maxSpeedMps, input.minLoadKg, input.maxLoadKg]);
    await audit(tx, ctx, 'package.update', 'package_version', input.id, {});
  });
}

export const slotSchema = z.object({ versionId: zUuid, categoryCode: zEnum(COMPONENT_CATEGORY), isMandatory: zBool, customerEditable: zBool });
/** Safety-critical categories are always mandatory and never customer-editable, whatever the form says. */
export async function addSlot(ctx: Ctx, input: z.infer<typeof slotSchema>): Promise<void> {
  requirePerm(ctx, 'package.manage');
  const safety = SAFETY_CRITICAL_CATEGORIES.includes(input.categoryCode);
  await withCtx(ctx, async (tx) => {
    await draftOf(tx, input.versionId);
    const cat = await tx.one<Rec>('select sort, customer_editable from component_categories where code = $1', [input.categoryCode]);
    await tx.exec(
      'insert into package_slots (version_id, category_code, is_mandatory, is_safety_critical, customer_editable, sort) values ($1,$2,$3,$4,$5,$6)',
      [input.versionId, input.categoryCode, safety || input.isMandatory, safety, !safety && cat.customer_editable && input.customerEditable, cat.sort]);
    await audit(tx, ctx, 'package.slot_add', 'package_version', input.versionId, { category: input.categoryCode });
  });
}

export async function removeSlot(ctx: Ctx, slotId: string): Promise<void> {
  requirePerm(ctx, 'package.manage');
  await withCtx(ctx, async (tx) => {
    const s = await tx.one<Rec>('select version_id, category_code from package_slots where id = $1', [slotId]);
    await draftOf(tx, s.version_id);
    await tx.exec('delete from package_slots where id = $1', [slotId]);
    await audit(tx, ctx, 'package.slot_remove', 'package_version', s.version_id, { category: s.category_code });
  });
}

export const optionSchema = z.object({ slotId: zUuid, productId: zUuid, kind: zEnum(OPTION_KIND) });
export async function addOption(ctx: Ctx, input: z.infer<typeof optionSchema>): Promise<void> {
  requirePerm(ctx, 'package.manage');
  await withCtx(ctx, async (tx) => {
    const s = await tx.one<Rec>('select version_id, category_code from package_slots where id = $1', [input.slotId]);
    await draftOf(tx, s.version_id);
    const p = await tx.one<Rec>('select category_code, approval_status from supplier_products where id = $1 and deleted_at is null', [input.productId]);
    if (p.approval_status !== 'APPROVED') throw new AppError('PRODUCT_NOT_APPROVED');
    if (p.category_code !== s.category_code) throw new AppError('CATEGORY_MISMATCH');
    await tx.exec('insert into package_slot_options (slot_id, product_id, kind) values ($1,$2,$3)', [input.slotId, input.productId, input.kind]);
    await audit(tx, ctx, 'package.option_add', 'package_version', s.version_id, { category: s.category_code, product: input.productId, kind: input.kind });
  });
}

export async function removeOption(ctx: Ctx, optionId: string): Promise<void> {
  requirePerm(ctx, 'package.manage');
  await withCtx(ctx, async (tx) => {
    const o = await tx.one<Rec>('select s.version_id from package_slot_options o join package_slots s on s.id = o.slot_id where o.id = $1', [optionId]);
    await draftOf(tx, o.version_id);
    await tx.exec('delete from package_slot_options where id = $1', [optionId]);
    await audit(tx, ctx, 'package.option_remove', 'package_version', o.version_id, { option: optionId });
  });
}

/** Required safety categories come from the active compatibility rules (or the draft defaults before activation). */
async function requiredSafety(tx: Tx): Promise<string[]> {
  const row = await tx.maybeOne<{ params: unknown }>(`select params from compatibility_rule_versions where status = 'ACTIVE'`);
  const parsed = row ? compatParamsSchema.safeParse(row.params) : null;
  return parsed?.success ? parsed.data.requiredSafetyCategories : DEFAULT_COMPAT_PARAMS.requiredSafetyCategories;
}

/** Publishes a draft (the previous published version is retired in the same transaction). */
export async function publishPackageVersion(ctx: Ctx, versionId: string): Promise<void> {
  requirePerm(ctx, 'package.manage');
  await withCtx(ctx, async (tx) => {
    const v = await draftOf(tx, versionId);
    const slots = await tx.query<Rec>(
      `select s.category_code, s.is_mandatory, (select count(*) from package_slot_options o where o.slot_id = s.id and o.kind = 'STANDARD') as standard,
              (select count(*) from package_slot_options o where o.slot_id = s.id) as options
         from package_slots s where s.version_id = $1`, [versionId]);
    const problems: string[] = [];
    if (!v.eligible_purposes?.length) problems.push('purposes');
    for (const cat of await requiredSafety(tx)) if (!slots.some((s) => s.category_code === cat)) problems.push(cat);
    for (const s of slots) {
      if (s.is_mandatory && Number(s.standard) !== 1) problems.push(s.category_code);
      if (!s.is_mandatory && Number(s.options) === 0) problems.push(s.category_code);
    }
    if (!slots.some((s) => (s.category_code as ComponentCategory) === 'MACHINE')) problems.push('MACHINE');
    if (problems.length) throw new AppError('PACKAGE_INCOMPLETE', { items: [...new Set(problems)].join(', ') });
    await tx.exec(`update package_versions set status = 'RETIRED', retired_at = now() where package_id = $1 and status = 'PUBLISHED'`, [v.package_id]);
    await tx.exec(`update package_versions set status = 'PUBLISHED', published_by = $2, published_at = now() where id = $1`, [versionId, ctx.userId]);
    await audit(tx, ctx, 'package.publish', 'package_version', versionId, { version: v.version_no });
    await emitEvent(tx, ctx, 'PACKAGE_PUBLISHED', `package-publish:${versionId}`, { type: 'package_version', id: versionId });
  });
}

export async function deletePackageDraft(ctx: Ctx, versionId: string): Promise<void> {
  requirePerm(ctx, 'package.manage');
  await withCtx(ctx, async (tx) => {
    await draftOf(tx, versionId);
    if (await tx.maybeOne('select 1 from configurations where package_version_id = $1 limit 1', [versionId])) throw new AppError('PACKAGE_IN_USE');
    await tx.exec('delete from package_versions where id = $1', [versionId]);
    await audit(tx, ctx, 'package.draft_delete', 'package_version', versionId, {});
  });
}
