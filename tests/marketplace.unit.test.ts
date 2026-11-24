// Pure-logic tests for the marketplace pricing and compatibility engines (no database).
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPAT_PARAMS, compatParamsSchema, evaluateCompatibility, type LiftSpec, type SelectedComponent } from '@/lib/compatibility';
import { calculatePrice, priceChangePercent, pricingParamsSchema, quantityFor, type PricingParams } from '@/lib/pricing';
import { toPaise } from '@/lib/commission';

const RULES: PricingParams = {
  installationBase: '40000', installationPerStop: '5000', transportDefault: '12000', transportByZone: { CHAKAN: '18000' },
  siteWorkBase: '10000', siteWorkPerStop: '0', overheadPercent: '8', marginPercent: '15', minMarginPercent: '10',
  maxDiscountPercent: '5', gstPercent: '18', floorHeightM: '3.2', quoteValidityDays: 15,
  paymentMilestones: [{ name: 'Booking', percent: 40 }, { name: 'Material delivery', percent: 50 }, { name: 'Handover', percent: 10 }],
};
const line = (over: Partial<Parameters<typeof calculatePrice>[0]['lines'][number]> = {}) => ({
  slotId: 's1', category: 'MACHINE' as const, kind: 'STANDARD' as const, productId: 'p1', productName: 'Motor', supplierName: 'Demo',
  priceId: 'pr1', unitCost: '100000', priceUnit: 'EACH' as const, ...over,
});

describe('pricing engine', () => {
  it('validates rule parameters (minimum margin cannot exceed target margin)', () => {
    expect(pricingParamsSchema.safeParse(RULES).success).toBe(true);
    expect(pricingParamsSchema.safeParse({ ...RULES, minMarginPercent: '20' }).success).toBe(false);
    expect(pricingParamsSchema.safeParse({ ...RULES, gstPercent: '18.5x' }).success).toBe(false);
    expect(pricingParamsSchema.safeParse({ ...RULES, paymentMilestones: [{ name: 'All', percent: 90 }] }).success).toBe(false);
  });

  it('derives quantities from price units (per stop, per travel metre rounded up)', () => {
    expect(quantityFor('EACH', 5, '3.2')).toBe(1);
    expect(quantityFor('PER_STOP', 5, '3.2')).toBe(5);
    expect(quantityFor('PER_TRAVEL_METRE', 5, '3.2')).toBe(13); // 4 × 3.2 = 12.8 → 13
    expect(quantityFor('PER_TRAVEL_METRE', 4, '3.0')).toBe(9);
  });

  it('follows the brief formula and every charge adds up exactly (integer paise)', () => {
    const r = calculatePrice({ lines: [line(), line({ slotId: 's2', category: 'LANDING_DOOR', unitCost: '9999.99', priceUnit: 'PER_STOP' })], stops: 4, zoneCode: 'WAKAD', rules: RULES });
    // material = 100000 + 4 × 9999.99
    expect(r.materialCost).toBe('139999.96');
    expect(r.installationCost).toBe('60000.00');
    expect(r.transportCost).toBe('12000.00');
    expect(r.siteWorkCost).toBe('10000.00');
    expect(r.projectCost).toBe('221999.96');
    const sumCharges = Object.values(r.charges).reduce((s, v) => s + toPaise(v), 0n);
    expect(sumCharges).toBe(toPaise(r.sellingBeforeDiscount));
    const sumLines = r.lines.reduce((s, l) => s + toPaise(l.customerPrice), 0n);
    expect(sumLines).toBe(toPaise(r.charges.materials));
    expect(toPaise(r.sellingPrice)).toBe(toPaise(r.projectCost) + toPaise(r.overheadAmount) + toPaise(r.marginAmount));
    expect(toPaise(r.totalPayable)).toBe(toPaise(r.sellingPrice) + toPaise(r.gstAmount));
    expect(r.exceptions).toEqual([]);
    expect(Number(r.marginPercent)).toBeCloseTo(15, 2);
  });

  it('uses location-specific transport when the zone has a rate', () => {
    expect(calculatePrice({ lines: [line()], stops: 3, zoneCode: 'CHAKAN', rules: RULES }).transportCost).toBe('18000.00');
  });

  it('shows the upgrade charge against the standard option', () => {
    const r = calculatePrice({ lines: [line({ kind: 'UPGRADE', unitCost: '120000', standardUnitCost: '100000' })], stops: 3, zoneCode: 'X', rules: RULES });
    // 20000 × 1.08 × 1.15 = 24840
    expect(r.lines[0].upgradeCharge).toBe('24840.00');
  });

  it('flags discounts above the limit and margins below the floor for owner approval', () => {
    const ok = calculatePrice({ lines: [line()], stops: 3, zoneCode: 'X', rules: RULES, discountPercent: '4' });
    expect(ok.exceptions).toEqual([]);
    // 15% margin × (1 − 4%) keeps ≈ 10.4% margin, but 4% exceeds a 3% discount limit
    const above = calculatePrice({ lines: [line()], stops: 3, zoneCode: 'X', rules: { ...RULES, maxDiscountPercent: '3' }, discountPercent: '4' });
    expect(above.exceptions).toEqual(['DISCOUNT_ABOVE_LIMIT']);
    // 6% discount: above the 5% limit and margin falls to ≈ 8.1%
    expect(calculatePrice({ lines: [line()], stops: 3, zoneCode: 'X', rules: RULES, discountPercent: '6' }).exceptions)
      .toEqual(['DISCOUNT_ABOVE_LIMIT', 'MARGIN_BELOW_FLOOR']);
    const floor = calculatePrice({ lines: [line()], stops: 3, zoneCode: 'X', rules: { ...RULES, maxDiscountPercent: '50' }, discountPercent: '10' });
    expect(floor.exceptions).toEqual(['MARGIN_BELOW_FLOOR']);
    expect(Number(floor.marginPercent)).toBeLessThan(10);
  });

  it('computes supplier price change percentages exactly', () => {
    expect(priceChangePercent('100000', '125000')).toBe('25.00');
    expect(priceChangePercent('100000', '10000')).toBe('-90.00');
    expect(priceChangePercent('3', '4')).toBe('33.33');
  });
});

const SPEC: LiftSpec = {
  purpose: 'PASSENGER', persons: 6, ratedLoadKg: 408, speedMps: 1, stops: 5, floors: 5, shaftWidthMm: 1700, shaftDepthMm: 1800,
  pitDepthMm: 1500, overheadMm: 4000, powerSupply: 'THREE_PHASE', accessibility: false, source: 'SURVEYED',
};
const PKG = { eligiblePurposes: ['PASSENGER', 'ACCESSIBLE'], minStops: 2, maxStops: 10, maxSpeedMps: 1.5, minLoadKg: 300, maxLoadKg: 1000 };
const comp = (slotCategory: SelectedComponent['slotCategory'], specs: Record<string, unknown> = {}, eligible = true): SelectedComponent =>
  ({ slotCategory, isMandatory: true, product: { id: slotCategory, name: slotCategory, specs, eligible } });
const GOOD: SelectedComponent[] = [
  comp('MACHINE', { maxLoadKg: 630, maxSpeedMps: 1.5, powerKw: 5.5, driveType: 'GEARLESS_PMSM' }),
  comp('CONTROLLER', { maxStops: 16, maxSpeedMps: 1.75, supportedDrives: ['GEARLESS_PMSM'] }),
  comp('CAR_CABIN', { carWidthMm: 1100, carDepthMm: 1300, ratedLoadKg: 544 }),
  comp('CAR_DOOR', { clearOpeningMm: 800 }), comp('LANDING_DOOR', { clearOpeningMm: 800 }),
  comp('GUIDE_RAILS'), comp('SAFETY_GEAR', { maxSpeedMps: 1.75, maxLoadKg: 1000 }), comp('GOVERNOR', { maxSpeedMps: 1.75 }),
  comp('BUFFERS', { maxSpeedMps: 1.75 }), comp('DOOR_LOCKS'), comp('ARD'),
];
const codes = (r: { findings: Array<{ code: string; level: string }> }, level?: string) => r.findings.filter((f) => !level || f.level === level).map((f) => f.code);
const swap = (category: string, specs: Record<string, unknown>) => GOOD.map((c) => (c.slotCategory === category ? comp(c.slotCategory, specs) : c));

describe('compatibility engine', () => {
  it('accepts the default draft rule parameters', () => {
    expect(compatParamsSchema.safeParse(DEFAULT_COMPAT_PARAMS).success).toBe(true);
  });
  it('returns GREEN for a surveyed, compatible configuration', () => {
    const r = evaluateCompatibility(SPEC, PKG, GOOD, DEFAULT_COMPAT_PARAMS);
    expect(r.findings).toEqual([]);
    expect(r.status).toBe('GREEN');
  });
  it('returns YELLOW for customer-declared dimensions and missing measurements', () => {
    const r = evaluateCompatibility({ ...SPEC, source: 'DECLARED', pitDepthMm: null }, PKG, GOOD, DEFAULT_COMPAT_PARAMS);
    expect(r.status).toBe('YELLOW');
    expect(codes(r)).toEqual(expect.arrayContaining(['DIMENSIONS_NOT_SURVEYED', 'MEASUREMENT_MISSING']));
  });
  it('rejects a rated load below the passenger count', () => {
    expect(codes(evaluateCompatibility({ ...SPEC, persons: 8 }, PKG, GOOD, DEFAULT_COMPAT_PARAMS), 'RED')).toContain('LOAD_BELOW_PERSONS');
  });
  it('rejects a motor that is too small or too slow', () => {
    const r = evaluateCompatibility({ ...SPEC, ratedLoadKg: 544, persons: 8 }, PKG, swap('MACHINE', { maxLoadKg: 408, maxSpeedMps: 0.5, powerKw: 3, driveType: 'GEARLESS_PMSM' }), DEFAULT_COMPAT_PARAMS);
    expect(codes(r, 'RED')).toEqual(expect.arrayContaining(['MOTOR_LOAD', 'MOTOR_SPEED']));
  });
  it('rejects a three-phase motor on a single-phase supply and flags an unknown supply', () => {
    expect(codes(evaluateCompatibility({ ...SPEC, powerSupply: 'SINGLE_PHASE' }, PKG, GOOD, DEFAULT_COMPAT_PARAMS), 'RED')).toContain('POWER_THREE_PHASE_REQUIRED');
    expect(codes(evaluateCompatibility({ ...SPEC, powerSupply: 'UNKNOWN' }, PKG, GOOD, DEFAULT_COMPAT_PARAMS), 'YELLOW')).toContain('POWER_SUPPLY_UNKNOWN');
  });
  it('rejects a controller that cannot serve the stops or the drive', () => {
    const r = evaluateCompatibility(SPEC, PKG, swap('CONTROLLER', { maxStops: 4, maxSpeedMps: 1.75, supportedDrives: ['GEARED'] }), DEFAULT_COMPAT_PARAMS);
    expect(codes(r, 'RED')).toEqual(expect.arrayContaining(['CONTROLLER_STOPS', 'CONTROLLER_DRIVE']));
  });
  it('rejects a cabin that does not fit the shaft', () => {
    const r = evaluateCompatibility({ ...SPEC, shaftWidthMm: 1300, shaftDepthMm: 1500 }, PKG, GOOD, DEFAULT_COMPAT_PARAMS);
    expect(codes(r, 'RED')).toEqual(expect.arrayContaining(['CABIN_WIDTH', 'CABIN_DEPTH']));
  });
  it('enforces accessible door widths', () => {
    expect(codes(evaluateCompatibility({ ...SPEC, accessibility: true }, PKG, GOOD, DEFAULT_COMPAT_PARAMS), 'RED')).toContain('DOOR_NOT_ACCESSIBLE');
  });
  it('treats a reduced pit as YELLOW and a pit below the reduced minimum as RED', () => {
    expect(evaluateCompatibility({ ...SPEC, pitDepthMm: 1200 }, PKG, GOOD, DEFAULT_COMPAT_PARAMS).status).toBe('YELLOW');
    expect(codes(evaluateCompatibility({ ...SPEC, pitDepthMm: 900 }, PKG, GOOD, DEFAULT_COMPAT_PARAMS), 'RED')).toContain('PIT_TOO_SHALLOW');
    expect(codes(evaluateCompatibility({ ...SPEC, overheadMm: 3000 }, PKG, GOOD, DEFAULT_COMPAT_PARAMS), 'RED')).toContain('OVERHEAD_TOO_LOW');
  });
  it('never allows a configuration without mandatory safety components or with an ineligible product', () => {
    const noSafety = GOOD.filter((c) => c.slotCategory !== 'GOVERNOR');
    expect(codes(evaluateCompatibility(SPEC, PKG, noSafety, DEFAULT_COMPAT_PARAMS), 'RED')).toContain('SAFETY_COMPONENT_MISSING');
    const suspended = GOOD.map((c) => (c.slotCategory === 'ARD' ? comp('ARD', {}, false) : c));
    expect(codes(evaluateCompatibility(SPEC, PKG, suspended, DEFAULT_COMPAT_PARAMS), 'RED')).toContain('PRODUCT_NOT_ELIGIBLE');
  });
  it('enforces package eligibility (stops, speed, purpose)', () => {
    const r = evaluateCompatibility({ ...SPEC, stops: 12, floors: 12, speedMps: 1.75, purpose: 'GOODS' }, PKG, GOOD, DEFAULT_COMPAT_PARAMS);
    expect(r.status).toBe('RED');
    expect(codes(r, 'RED')).toEqual(expect.arrayContaining(['PACKAGE_STOPS', 'PACKAGE_SPEED', 'PACKAGE_PURPOSE']));
  });
  it('rates safety components for the duty speed', () => {
    const r = evaluateCompatibility(SPEC, PKG, swap('GOVERNOR', { maxSpeedMps: 0.63 }), DEFAULT_COMPAT_PARAMS);
    expect(codes(r, 'RED')).toContain('SAFETY_RATING_SPEED');
  });
});
