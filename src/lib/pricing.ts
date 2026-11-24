// Central pricing engine (brief section 6). Pure, integer paise, no floating point, no I/O.
//
//   Material cost   = Σ approved component cost × quantity
//   Project cost    = material + installation labour + transportation + site work
//   Selling price   = project cost + operational overhead + approved business margin − approved discount
//   Final payable   = selling price + GST
//
// Overhead and margin are applied per line so that every customer-facing line price adds up
// exactly to the selling price. Supplier costs and margins never leave the server: only
// `customerLines`, `charges` and the totals are shown to customers.
import { z } from 'zod';
import { fromPaise, percentOf, rateToE4, toPaise } from './commission';
import type { ComponentCategory, OptionKind, PriceUnit } from './enums';

const money = z.string().regex(/^\d{1,11}(\.\d{1,2})?$/, 'INVALID_AMOUNT');
const rate = z.string().regex(/^\d{1,2}(\.\d{1,4})?$/, 'INVALID');

export const pricingParamsSchema = z.object({
  installationBase: money,
  installationPerStop: money,
  transportDefault: money,
  /** Zone code → transport charge (location-specific logistics). */
  transportByZone: z.record(z.string(), money),
  siteWorkBase: money,
  siteWorkPerStop: money,
  overheadPercent: rate,
  marginPercent: rate,
  minMarginPercent: rate,
  maxDiscountPercent: rate,
  /** GST rate for the lift supply-and-installation contract. Confirm the classification with AIEC's CA. */
  gstPercent: rate,
  floorHeightM: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, 'INVALID'),
  quoteValidityDays: z.number().int().min(1).max(90),
  /** Customer payment milestones printed on every quotation; percentages must total 100. */
  paymentMilestones: z.array(z.object({ name: z.string().trim().min(1).max(120), percent: z.number().positive().max(100) })).min(1).max(10)
    .refine((m) => Math.round(m.reduce((s, x) => s + x.percent * 100, 0)) === 10000, 'MILESTONES_TOTAL'),
}).refine((p) => rateToE4(p.minMarginPercent) <= rateToE4(p.marginPercent), { message: 'MIN_MARGIN_ABOVE_MARGIN', path: ['minMarginPercent'] });
export type PricingParams = z.infer<typeof pricingParamsSchema>;

export interface PriceLineInput {
  slotId: string;
  category: ComponentCategory;
  kind: OptionKind | null;
  productId: string;
  productName: string;
  supplierName: string;
  priceId: string;
  /** Approved unit cost (decimal string, INR). */
  unitCost: string;
  priceUnit: PriceUnit;
  /** Customer price of the slot's STANDARD option (same quantity basis) for the upgrade charge, if any. */
  standardUnitCost?: string | null;
}

export interface PricingInput {
  lines: PriceLineInput[];
  stops: number;
  zoneCode: string;
  discountPercent?: string;
  rules: PricingParams;
}

export interface PricedLine {
  slotId: string; category: ComponentCategory; kind: OptionKind | null; productId: string; productName: string; supplierName: string;
  priceId: string; priceUnit: PriceUnit; quantity: number;
  unitCost: string; lineCost: string;
  /** Customer-facing price of this line (cost + overhead + margin). */
  customerPrice: string;
  /** Customer price minus the standard option's customer price (0 for the standard option). */
  upgradeCharge: string;
}

export interface PricingResult {
  lines: PricedLine[];
  materialCost: string; installationCost: string; transportCost: string; siteWorkCost: string; projectCost: string;
  overheadAmount: string; marginAmount: string; marginPercent: string;
  sellingBeforeDiscount: string; discountPercent: string; discountAmount: string; sellingPrice: string;
  gstPercent: string; gstAmount: string; totalPayable: string;
  /** Customer-facing charges (marked up). They sum to `sellingBeforeDiscount`. */
  charges: { materials: string; installation: string; transport: string; siteWork: string };
  /** Reasons the price needs owner approval before it can be issued. */
  exceptions: Array<'DISCOUNT_ABOVE_LIMIT' | 'MARGIN_BELOW_FLOOR'>;
}

const E4 = 10000n; // rate scale used by rateToE4

/** Quantity of a line from its price unit. Travel height = (stops − 1) × floor height, rounded up to whole metres. */
export function quantityFor(unit: PriceUnit, stops: number, floorHeightM: string): number {
  if (unit === 'EACH') return 1;
  if (unit === 'PER_STOP') return stops;
  const cm = BigInt(stops - 1) * toPaise(floorHeightM); // metres with 2 decimals → "centimetres"
  return Number((cm + 99n) / 100n);
}

/** cost × (1 + overhead%) × (1 + margin%), rounded to the paisa once. */
function markUp(costPaise: bigint, overheadE4: bigint, marginE4: bigint): bigint {
  const scale = 100n * E4; // percent × rate scale
  const num = costPaise * (scale + overheadE4) * (scale + marginE4);
  const den = scale * scale;
  return (num + den / 2n) / den;
}

export function calculatePrice(input: PricingInput): PricingResult {
  const { rules, stops } = input;
  const overheadE4 = rateToE4(rules.overheadPercent);
  const marginE4 = rateToE4(rules.marginPercent);
  const discountPercent = input.discountPercent ?? '0';
  const discountE4 = rateToE4(discountPercent);
  if (discountE4 >= 100n * E4) throw new Error('Discount must be below 100%');

  const lines: PricedLine[] = input.lines.map((l) => {
    const quantity = quantityFor(l.priceUnit, stops, rules.floorHeightM);
    const lineCost = toPaise(l.unitCost) * BigInt(quantity);
    const customer = markUp(lineCost, overheadE4, marginE4);
    const standard = l.standardUnitCost ? markUp(toPaise(l.standardUnitCost) * BigInt(quantity), overheadE4, marginE4) : customer;
    const upgrade = customer - standard;
    return {
      slotId: l.slotId, category: l.category, kind: l.kind, productId: l.productId, productName: l.productName, supplierName: l.supplierName,
      priceId: l.priceId, priceUnit: l.priceUnit, quantity, unitCost: fromPaise(toPaise(l.unitCost)), lineCost: fromPaise(lineCost),
      customerPrice: fromPaise(customer), upgradeCharge: fromPaise(upgrade > 0n ? upgrade : 0n),
    };
  });

  const material = lines.reduce((s, l) => s + toPaise(l.lineCost), 0n);
  const installation = toPaise(rules.installationBase) + toPaise(rules.installationPerStop) * BigInt(stops);
  const transport = toPaise(rules.transportByZone[input.zoneCode] ?? rules.transportDefault);
  const siteWork = toPaise(rules.siteWorkBase) + toPaise(rules.siteWorkPerStop) * BigInt(stops);
  const projectCost = material + installation + transport + siteWork;

  const chargeMaterials = lines.reduce((s, l) => s + toPaise(l.customerPrice), 0n);
  const chargeInstallation = markUp(installation, overheadE4, marginE4);
  const chargeTransport = markUp(transport, overheadE4, marginE4);
  const chargeSiteWork = markUp(siteWork, overheadE4, marginE4);
  const sellingBefore = chargeMaterials + chargeInstallation + chargeTransport + chargeSiteWork;

  const overhead = percentOf(projectCost, overheadE4);
  const discount = percentOf(sellingBefore, discountE4);
  const selling = sellingBefore - discount;
  const margin = selling - projectCost - overhead;
  const base = projectCost + overhead;
  // margin % of (project cost + overhead), 4 decimals, rounded half away from zero
  const marginPctE4 = base === 0n ? 0n : (margin * 100n * E4 * 2n + (margin >= 0n ? base : -base)) / (2n * base);
  const gstE4 = rateToE4(rules.gstPercent);
  const gst = percentOf(selling, gstE4);

  const exceptions: PricingResult['exceptions'] = [];
  if (discountE4 > rateToE4(rules.maxDiscountPercent)) exceptions.push('DISCOUNT_ABOVE_LIMIT');
  if (marginPctE4 < rateToE4(rules.minMarginPercent)) exceptions.push('MARGIN_BELOW_FLOOR');

  const pct = (v: bigint) => { const neg = v < 0n; const a = neg ? -v : v; return `${neg ? '-' : ''}${a / E4}.${String(a % E4).padStart(4, '0')}`; };
  return {
    lines,
    materialCost: fromPaise(material), installationCost: fromPaise(installation), transportCost: fromPaise(transport), siteWorkCost: fromPaise(siteWork),
    projectCost: fromPaise(projectCost), overheadAmount: fromPaise(overhead), marginAmount: fromPaise(margin), marginPercent: pct(marginPctE4),
    sellingBeforeDiscount: fromPaise(sellingBefore), discountPercent: pct(discountE4), discountAmount: fromPaise(discount), sellingPrice: fromPaise(selling),
    gstPercent: pct(gstE4), gstAmount: fromPaise(gst), totalPayable: fromPaise(selling + gst),
    charges: { materials: fromPaise(chargeMaterials), installation: fromPaise(chargeInstallation), transport: fromPaise(chargeTransport), siteWork: fromPaise(chargeSiteWork) },
    exceptions,
  };
}

/** Relative change of a new supplier price against the last approved one, in percent (2 decimals). */
export function priceChangePercent(previous: string, next: string): string {
  const p = toPaise(previous); const n = toPaise(next);
  if (p === 0n) return '0.00';
  const diff = (n - p) * 10000n; // percent × 100
  const v = (diff >= 0n ? diff + p / 2n : diff - p / 2n) / p;
  const neg = v < 0n; const a = neg ? -v : v;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}
