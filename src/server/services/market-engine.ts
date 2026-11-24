// Loads everything the two engines need and runs them. Always called on the trusted path
// (withSystem) AFTER the caller's access to the lead / configuration has been checked, because it
// reads supplier costs and pricing rules that customers must never see. Only customer-facing
// values are returned in `CustomerView`; internal values stay in `internal`.
import { compatParamsSchema, evaluateCompatibility, type CompatParams, type CompatResult, type LiftSpec } from '@/lib/compatibility';
import type { ComponentCategory, LiftPurpose, OptionKind, PowerSupply, PriceUnit } from '@/lib/enums';
import { calculatePrice, pricingParamsSchema, type PricingParams, type PricingResult } from '@/lib/pricing';
import type { Rec, Tx } from '../db';

export interface ActiveRules {
  pricing: { id: string; versionNo: number; params: PricingParams } | null;
  compatibility: { id: string; versionNo: number; params: CompatParams } | null;
}

export async function loadActiveRules(tx: Tx): Promise<ActiveRules> {
  const p = await tx.maybeOne<{ id: string; version_no: number; params: unknown }>('select * from app.active_pricing_rules()');
  const c = await tx.maybeOne<{ id: string; version_no: number; params: unknown }>(`select id, version_no, params from compatibility_rule_versions where status = 'ACTIVE'`);
  const pp = p ? pricingParamsSchema.safeParse(p.params) : null;
  const cp = c ? compatParamsSchema.safeParse(c.params) : null;
  return {
    pricing: p && pp?.success ? { id: p.id, versionNo: p.version_no, params: pp.data } : null,
    compatibility: c && cp?.success ? { id: c.id, versionNo: c.version_no, params: cp.data } : null,
  };
}

export interface ProjectSpec { spec: LiftSpec; zoneCode: string; surveyId: string | null }

/** Customer-declared specification, overridden field by field by the latest AIEC-reviewed site survey. */
export async function loadSpec(tx: Tx, leadId: string): Promise<ProjectSpec | null> {
  const s = await tx.maybeOne<Rec>(
    `select m.*, z.code as zone_code from market_project_specs m join leads l on l.id = m.lead_id join zones z on z.id = l.zone_id where m.lead_id = $1`, [leadId]);
  if (!s) return null;
  const sv = await tx.maybeOne<Rec>(
    `select id, floors, stops, shaft_width_mm, shaft_depth_mm, pit_depth_mm, overhead_mm from site_surveys
      where lead_id = $1 and status = 'REVIEWED' order by reviewed_at desc nulls last limit 1`, [leadId]);
  const pick = (surveyed: unknown, declared: unknown): number | null => {
    const v = surveyed ?? declared;
    return v === null || v === undefined ? null : Number(v);
  };
  return {
    zoneCode: s.zone_code,
    surveyId: sv?.id ?? null,
    spec: {
      purpose: s.purpose as LiftPurpose,
      persons: s.persons === null ? null : Number(s.persons),
      ratedLoadKg: s.rated_load_kg === null ? null : Number(s.rated_load_kg),
      speedMps: s.speed_mps === null ? null : Number(s.speed_mps),
      floors: pick(sv?.floors, s.floors),
      stops: pick(sv?.stops, s.stops),
      shaftWidthMm: pick(sv?.shaft_width_mm, s.shaft_width_mm),
      shaftDepthMm: pick(sv?.shaft_depth_mm, s.shaft_depth_mm),
      pitDepthMm: pick(sv?.pit_depth_mm, s.pit_depth_mm),
      overheadMm: pick(sv?.overhead_mm, s.overhead_mm),
      powerSupply: s.power_supply as PowerSupply,
      accessibility: Boolean(s.accessibility),
      source: sv ? 'SURVEYED' : 'DECLARED',
    },
  };
}

export interface OptionView {
  productId: string; kind: OptionKind; name: string; brand: string; model: string; supplierId: string; supplierName: string;
  supplierStatus: string; warrantyMonths: number; deliveryDays: number; inStock: boolean; specs: Record<string, unknown>;
  imageFileId: string | null; documentFileId: string | null; eligible: boolean;
  /** Customer price for this option (null when it cannot be priced) and the charge over the standard option. */
  customerPrice: string | null; upgradeCharge: string | null;
}
export interface SlotView {
  slotId: string; category: ComponentCategory; isMandatory: boolean; isSafetyCritical: boolean; customerEditable: boolean;
  selectedProductId: string | null; options: OptionView[];
}
export type PricingStatus = 'OK' | 'NOT_CONFIGURED' | 'PRICE_UNAVAILABLE' | 'STOPS_UNKNOWN';
export interface Evaluation {
  packageVersion: Rec;
  spec: ProjectSpec;
  slots: SlotView[];
  compat: CompatResult | null;
  compatStatus: 'OK' | 'NOT_CONFIGURED';
  pricing: PricingResult | null;
  pricingStatus: PricingStatus;
  rules: ActiveRules;
}

/**
 * Evaluates one set of selections for a package version and a lead.
 * `selections`: slotId → productId (null = optional slot left out). Missing keys use the standard option.
 */
export async function evaluate(
  tx: Tx, input: { leadId: string; packageVersionId: string; selections?: Map<string, string | null>; discountPercent?: string },
): Promise<Evaluation> {
  const spec = await loadSpec(tx, input.leadId);
  if (!spec) throw new Error('SPEC_MISSING');
  const rules = await loadActiveRules(tx);
  const packageVersion = await tx.one<Rec>('select v.*, p.code from package_versions v join lift_packages p on p.id = v.package_id where v.id = $1', [input.packageVersionId]);
  const slots = await tx.query<Rec>('select * from package_slots where version_id = $1 order by sort, category_code', [input.packageVersionId]);
  const options = await tx.query<Rec>(
    `select o.slot_id, o.kind, sp.id, sp.name, sp.brand, sp.model, sp.specs, sp.price_unit, sp.warranty_months, sp.delivery_days, sp.stock_qty,
            sp.image_file_id, sp.document_file_id, c.id as supplier_id, c.legal_name as supplier_name, c.marketplace_status
       from package_slot_options o join package_slots s on s.id = o.slot_id join supplier_products sp on sp.id = o.product_id
       join companies c on c.id = sp.company_id where s.version_id = $1`, [input.packageVersionId]);
  const costs = await tx.query<{ product_id: string; price_id: string; unit_price: string }>(
    'select product_id, price_id, unit_price::text from app.eligible_product_costs($1)', [[...new Set(options.map((o) => o.id))]]);
  const costOf = new Map(costs.map((c) => [c.product_id, c]));
  const stops = spec.spec.stops;
  const p = rules.pricing;

  const priceOne = (unitCost: string, priceUnit: PriceUnit, standardUnitCost: string | null): { customer: string; upgrade: string } | null => {
    if (!p || stops === null) return null;
    const r = calculatePrice({
      lines: [{ slotId: '-', category: 'ADD_ON', kind: null, productId: '-', productName: '-', supplierName: '-', priceId: '-', unitCost, priceUnit, standardUnitCost }],
      stops, zoneCode: spec.zoneCode, rules: p.params,
    });
    return { customer: r.lines[0].customerPrice, upgrade: r.lines[0].upgradeCharge };
  };

  const slotViews: SlotView[] = slots.map((s) => {
    const opts = options.filter((o) => o.slot_id === s.id);
    const standard = opts.find((o) => o.kind === 'STANDARD');
    const standardCost = standard ? costOf.get(standard.id)?.unit_price ?? null : null;
    const chosen = input.selections?.has(s.id) ? input.selections.get(s.id)! : (s.is_mandatory ? standard?.id ?? null : null);
    return {
      slotId: s.id, category: s.category_code, isMandatory: s.is_mandatory, isSafetyCritical: s.is_safety_critical, customerEditable: s.customer_editable,
      selectedProductId: chosen,
      options: opts.map((o) => {
        const cost = costOf.get(o.id);
        const priced = cost ? priceOne(cost.unit_price, o.price_unit, s.is_mandatory ? standardCost : null) : null;
        return {
          productId: o.id, kind: o.kind, name: o.name, brand: o.brand, model: o.model, supplierId: o.supplier_id, supplierName: o.supplier_name,
          supplierStatus: o.marketplace_status, warrantyMonths: o.warranty_months, deliveryDays: o.delivery_days, inStock: Number(o.stock_qty) > 0,
          specs: o.specs ?? {}, imageFileId: o.image_file_id, documentFileId: o.document_file_id, eligible: Boolean(cost),
          customerPrice: priced?.customer ?? null, upgradeCharge: priced?.upgrade ?? null,
        };
      }).sort((a, b) => (a.kind === 'STANDARD' ? -1 : b.kind === 'STANDARD' ? 1 : (Number(a.customerPrice ?? 0) - Number(b.customerPrice ?? 0)))),
    };
  });

  // A selected product that is not (or no longer) an option of the slot is treated as ineligible.
  const selected = slotViews.map((sv) => {
    const opt = sv.options.find((o) => o.productId === sv.selectedProductId) ?? null;
    return { sv, opt, orphan: sv.selectedProductId !== null && !opt };
  });

  const compat = rules.compatibility ? evaluateCompatibility(spec.spec, {
    eligiblePurposes: packageVersion.eligible_purposes ?? [], minStops: packageVersion.min_stops, maxStops: packageVersion.max_stops,
    maxSpeedMps: Number(packageVersion.max_speed_mps), minLoadKg: packageVersion.min_load_kg, maxLoadKg: packageVersion.max_load_kg,
  }, selected.map(({ sv, opt, orphan }) => ({
    slotCategory: sv.category, isMandatory: sv.isMandatory,
    product: opt ? { id: opt.productId, name: opt.name, specs: opt.specs, eligible: opt.eligible } : orphan ? { id: sv.selectedProductId!, name: '-', specs: {}, eligible: false } : null,
  })), rules.compatibility.params) : null;

  let pricing: PricingResult | null = null;
  let pricingStatus: PricingStatus = 'OK';
  if (!p) pricingStatus = 'NOT_CONFIGURED';
  else if (stops === null) pricingStatus = 'STOPS_UNKNOWN';
  else if (selected.some(({ opt, orphan }) => orphan || (opt && !opt.eligible))) pricingStatus = 'PRICE_UNAVAILABLE';
  else {
    const lines = selected.filter(({ opt }) => opt).map(({ sv, opt }) => {
      const std = sv.options.find((o) => o.kind === 'STANDARD');
      const optCost = costOf.get(opt!.productId)!;
      return {
        slotId: sv.slotId, category: sv.category, kind: opt!.kind, productId: opt!.productId, productName: opt!.name, supplierName: opt!.supplierName,
        priceId: optCost.price_id, unitCost: optCost.unit_price, priceUnit: options.find((o) => o.id === opt!.productId)!.price_unit as PriceUnit,
        standardUnitCost: sv.isMandatory && std ? costOf.get(std.productId)?.unit_price ?? null : null,
      };
    });
    pricing = calculatePrice({ lines, stops, zoneCode: spec.zoneCode, rules: p.params, discountPercent: input.discountPercent });
  }
  return { packageVersion, spec, slots: slotViews, compat, compatStatus: rules.compatibility ? 'OK' : 'NOT_CONFIGURED', pricing, pricingStatus, rules };
}

/** Customer-safe projection of an evaluation (no costs, margins or price ids). */
export function customerView(e: Evaluation) {
  const priced = new Map(e.pricing?.lines.map((l) => [l.slotId, l]) ?? []);
  return {
    packageVersion: {
      id: e.packageVersion.id, code: e.packageVersion.code, title: e.packageVersion.title, versionNo: e.packageVersion.version_no,
      warrantyMonths: e.packageVersion.warranty_months, features: e.packageVersion.features, exclusions: e.packageVersion.exclusions,
    },
    spec: e.spec.spec, zoneCode: e.spec.zoneCode,
    slots: e.slots.map((s) => ({ ...s, line: priced.get(s.slotId) ? { quantity: priced.get(s.slotId)!.quantity, customerPrice: priced.get(s.slotId)!.customerPrice, upgradeCharge: priced.get(s.slotId)!.upgradeCharge } : null })),
    compat: e.compat, compatStatus: e.compatStatus, pricingStatus: e.pricingStatus,
    totals: e.pricing ? {
      charges: e.pricing.charges, sellingBeforeDiscount: e.pricing.sellingBeforeDiscount, discountPercent: e.pricing.discountPercent,
      discountAmount: e.pricing.discountAmount, sellingPrice: e.pricing.sellingPrice, gstPercent: e.pricing.gstPercent, gstAmount: e.pricing.gstAmount,
      totalPayable: e.pricing.totalPayable,
    } : null,
  };
}
export type CustomerView = ReturnType<typeof customerView>;
