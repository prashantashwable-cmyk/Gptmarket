// Versioned pricing and compatibility rules. Parameters freeze once a version leaves DRAFT
// (database trigger), so every quotation can name the exact rules it was calculated with.
import { z } from 'zod';
import { compatParamsSchema } from '@/lib/compatibility';
import { AppError } from '@/lib/errors';
import { pricingParamsSchema, type PricingParams } from '@/lib/pricing';
import { zOptText, zUuid } from '@/lib/validation';
import { audit } from '../audit';
import { requirePerm, type Ctx } from '../ctx';
import { withCtx, type Rec } from '../db';
import { emitEvent } from './automation';

type Kind = 'pricing' | 'compatibility';
const TABLE: Record<Kind, string> = { pricing: 'pricing_rule_versions', compatibility: 'compatibility_rule_versions' };

export async function listRules(ctx: Ctx) {
  requirePerm(ctx, 'pricing.manage', 'pricing.approve', 'engineering.approve');
  return withCtx(ctx, async (tx) => {
    const [pricing, compatibility] = await Promise.all([
      tx.query<Rec>(`select r.*, u.full_name as activated_by_name from pricing_rule_versions r left join users u on u.id = r.activated_by order by version_no desc`),
      tx.query<Rec>(`select r.*, u.full_name as activated_by_name from compatibility_rule_versions r left join users u on u.id = r.activated_by order by version_no desc`),
    ]);
    return { pricing, compatibility };
  });
}

/** Form fields (all strings) → pricing parameters; zone transport is entered one "ZONE=amount" per line. */
export const pricingFormSchema = z.object({
  installationBase: z.string(), installationPerStop: z.string(), transportDefault: z.string(), transportByZone: zOptText(2000),
  siteWorkBase: z.string(), siteWorkPerStop: z.string(), overheadPercent: z.string(), marginPercent: z.string(), minMarginPercent: z.string(),
  maxDiscountPercent: z.string(), gstPercent: z.string(), floorHeightM: z.string(), quoteValidityDays: z.coerce.number(), paymentMilestones: zOptText(2000), note: zOptText(1000),
});
export function pricingParamsFromForm(input: z.infer<typeof pricingFormSchema>): PricingParams {
  const zones: Record<string, string> = {};
  for (const line of (input.transportByZone ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^([A-Z_]+)\s*=\s*(\S+)$/.exec(line.toUpperCase());
    if (!m) throw new AppError('VALIDATION', undefined, { transportByZone: 'INVALID' });
    zones[m[1]] = m[2];
  }
  const milestones: Array<{ name: string; percent: number }> = [];
  for (const line of (input.paymentMilestones ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^(.+?)\s*=\s*(\d{1,3}(?:\.\d{1,2})?)$/.exec(line);
    if (!m) throw new AppError('VALIDATION', undefined, { paymentMilestones: 'INVALID' });
    milestones.push({ name: m[1].trim(), percent: Number(m[2]) });
  }
  const { note: _note, ...rest } = input;
  void _note;
  const parsed = pricingParamsSchema.safeParse({ ...rest, transportByZone: zones, paymentMilestones: milestones });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? '_')] ??= /^[A-Z_]+$/.test(issue.message) ? issue.message : 'INVALID';
    throw new AppError('VALIDATION', undefined, fieldErrors);
  }
  return parsed.data;
}

export async function createPricingDraft(ctx: Ctx, params: PricingParams, note: string | null, isDemo = false): Promise<string> {
  requirePerm(ctx, 'pricing.manage', 'pricing.approve');
  return withCtx(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(
      `insert into pricing_rule_versions (version_no, params, note, is_demo, created_by)
       values ((select coalesce(max(version_no), 0) + 1 from pricing_rule_versions), $1, $2, $3, $4) returning id`,
      [JSON.stringify(params), note, isDemo, ctx.userId]);
    await audit(tx, ctx, 'rules.pricing_draft', 'pricing_rules', row.id, {});
    return row.id;
  });
}

export const compatFormSchema = z.object({ params: z.string().min(2, 'REQUIRED').max(20000, 'TOO_LONG'), note: zOptText(1000) });
export async function createCompatibilityDraft(ctx: Ctx, input: z.infer<typeof compatFormSchema>): Promise<string> {
  requirePerm(ctx, 'engineering.approve');
  let json: unknown;
  try { json = JSON.parse(input.params); } catch { throw new AppError('VALIDATION', undefined, { params: 'INVALID_JSON' }); }
  const parsed = compatParamsSchema.safeParse(json);
  if (!parsed.success) throw new AppError('VALIDATION', undefined, { params: 'INVALID_RULES' });
  return withCtx(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(
      `insert into compatibility_rule_versions (version_no, params, note, created_by)
       values ((select coalesce(max(version_no), 0) + 1 from compatibility_rule_versions), $1, $2, $3) returning id`,
      [JSON.stringify(parsed.data), input.note ?? null, ctx.userId]);
    await audit(tx, ctx, 'rules.compatibility_draft', 'compatibility_rules', row.id, {});
    return row.id;
  });
}

export const activateSchema = z.object({ id: zUuid, kind: z.enum(['pricing', 'compatibility']) });
/** Owner (pricing) or authorised engineer (compatibility) activates a draft; the previous active version retires. */
export async function activateRules(ctx: Ctx, input: z.infer<typeof activateSchema>): Promise<void> {
  requirePerm(ctx, input.kind === 'pricing' ? 'pricing.approve' : 'engineering.approve');
  const table = TABLE[input.kind];
  await withCtx(ctx, async (tx) => {
    const r = await tx.one<Rec>(`select id, status, params, version_no from ${table} where id = $1 for update`, [input.id]);
    if (r.status !== 'DRAFT') throw new AppError('INVALID_TRANSITION');
    const valid = input.kind === 'pricing' ? pricingParamsSchema.safeParse(r.params).success : compatParamsSchema.safeParse(r.params).success;
    if (!valid) throw new AppError('INVALID_RULES');
    await tx.exec(`update ${table} set status = 'RETIRED', retired_at = now() where status = 'ACTIVE'`);
    await tx.exec(`update ${table} set status = 'ACTIVE', activated_by = $2, activated_at = now() where id = $1`, [r.id, ctx.userId]);
    await audit(tx, ctx, `rules.${input.kind}_activate`, `${input.kind}_rules`, r.id, { version: r.version_no });
    await emitEvent(tx, ctx, 'RULES_ACTIVATED', `rules-activate:${input.kind}:${r.id}`, { type: `${input.kind}_rules`, id: r.id }, { version: r.version_no });
  });
}
