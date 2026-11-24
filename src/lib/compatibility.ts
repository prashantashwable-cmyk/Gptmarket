// Engineering compatibility engine (brief section 7). Pure functions, no I/O.
//
//   GREEN  – compatible under the active rule version
//   YELLOW – engineering approval required (documented decision by an authorised engineer)
//   RED    – incompatible: cannot be quoted, approved or ordered
//
// The engine never replaces engineering judgement: every FINAL quotation still needs an
// engineer's approval even when the result is GREEN. Rule parameters are versioned in
// `compatibility_rule_versions`; the defaults below are a draft that AIEC's authorised lift
// engineer must confirm against IS 14665, the applicable BIS standards and the Maharashtra Lifts,
// Escalators and Moving Walks Rules, 2026 before activation.
import { z } from 'zod';
import type { CompatLevel, ComponentCategory, LiftPurpose, PowerSupply } from './enums';

const band = z.object({
  maxSpeedMps: z.number().positive(),
  minPitMm: z.number().int().min(0),
  reducedPitMm: z.number().int().min(0),
  minOverheadMm: z.number().int().min(0),
  reducedOverheadMm: z.number().int().min(0),
}).refine((b) => b.reducedPitMm <= b.minPitMm && b.reducedOverheadMm <= b.minOverheadMm, 'REDUCED_ABOVE_MIN');

export const compatParamsSchema = z.object({
  kgPerPerson: z.number().int().min(50).max(100),
  sideClearanceMm: z.number().int().min(0).max(2000),
  depthClearanceMm: z.number().int().min(0).max(2000),
  accessibleMinDoorMm: z.number().int().min(500).max(2000),
  threePhaseAboveKw: z.number().positive().max(100),
  reviewAboveSpeedMps: z.number().positive().max(10),
  requiredSafetyCategories: z.array(z.string()).min(1),
  /** Pit / overhead bands by speed, per lift purpose (`DEFAULT` is the fallback). Sorted by maxSpeedMps. */
  pitOverheadBands: z.record(z.string(), z.array(band).min(1)).refine((r) => 'DEFAULT' in r, 'DEFAULT_BAND_REQUIRED'),
});
export type CompatParams = z.infer<typeof compatParamsSchema>;

export const DEFAULT_COMPAT_PARAMS: CompatParams = {
  kgPerPerson: 68,
  sideClearanceMm: 300,
  depthClearanceMm: 400,
  accessibleMinDoorMm: 900,
  threePhaseAboveKw: 3.7,
  reviewAboveSpeedMps: 1.75,
  requiredSafetyCategories: ['GUIDE_RAILS', 'SAFETY_GEAR', 'GOVERNOR', 'BUFFERS', 'DOOR_LOCKS', 'ARD'],
  pitOverheadBands: {
    DEFAULT: [
      { maxSpeedMps: 1.0, minPitMm: 1400, reducedPitMm: 1000, minOverheadMm: 3800, reducedOverheadMm: 3400 },
      { maxSpeedMps: 1.5, minPitMm: 1600, reducedPitMm: 1200, minOverheadMm: 4200, reducedOverheadMm: 3800 },
      { maxSpeedMps: 2.5, minPitMm: 2200, reducedPitMm: 1800, minOverheadMm: 4800, reducedOverheadMm: 4400 },
    ],
    HOME: [
      { maxSpeedMps: 0.4, minPitMm: 300, reducedPitMm: 100, minOverheadMm: 2700, reducedOverheadMm: 2500 },
      { maxSpeedMps: 1.0, minPitMm: 600, reducedPitMm: 300, minOverheadMm: 3200, reducedOverheadMm: 2900 },
    ],
  },
};

/** Technical attributes a product must declare, per category (validated when the supplier submits it). */
export const productSpecSchemas: Partial<Record<ComponentCategory, z.ZodType>> = {
  MACHINE: z.object({
    maxLoadKg: z.coerce.number().int().min(50).max(20000),
    maxSpeedMps: z.coerce.number().min(0.1).max(10),
    powerKw: z.coerce.number().min(0.1).max(200),
    driveType: z.enum(['GEARLESS_PMSM', 'GEARED', 'HYDRAULIC']),
  }),
  CONTROLLER: z.object({
    maxStops: z.coerce.number().int().min(2).max(100),
    maxSpeedMps: z.coerce.number().min(0.1).max(10),
    supportedDrives: z.array(z.enum(['GEARLESS_PMSM', 'GEARED', 'HYDRAULIC'])).min(1),
  }),
  CAR_CABIN: z.object({
    carWidthMm: z.coerce.number().int().min(500).max(5000),
    carDepthMm: z.coerce.number().int().min(500).max(6000),
    ratedLoadKg: z.coerce.number().int().min(50).max(20000),
  }),
  CAR_DOOR: z.object({ clearOpeningMm: z.coerce.number().int().min(500).max(3000) }),
  LANDING_DOOR: z.object({ clearOpeningMm: z.coerce.number().int().min(500).max(3000) }),
  SAFETY_GEAR: z.object({ maxSpeedMps: z.coerce.number().min(0.1).max(10), maxLoadKg: z.coerce.number().int().min(50).max(20000) }),
  GOVERNOR: z.object({ maxSpeedMps: z.coerce.number().min(0.1).max(10) }),
  BUFFERS: z.object({ maxSpeedMps: z.coerce.number().min(0.1).max(10) }),
};

export interface LiftSpec {
  purpose: LiftPurpose;
  persons: number | null;
  ratedLoadKg: number | null;
  speedMps: number | null;
  stops: number | null;
  floors: number | null;
  shaftWidthMm: number | null;
  shaftDepthMm: number | null;
  pitDepthMm: number | null;
  overheadMm: number | null;
  powerSupply: PowerSupply;
  accessibility: boolean;
  /** DECLARED by the customer, or SURVEYED (from a reviewed AIEC site survey). */
  source: 'DECLARED' | 'SURVEYED';
}

export interface PackageEligibility {
  eligiblePurposes: string[];
  minStops: number; maxStops: number;
  maxSpeedMps: number;
  minLoadKg: number; maxLoadKg: number;
}

export interface SelectedComponent {
  slotCategory: ComponentCategory;
  isMandatory: boolean;
  product: null | {
    id: string;
    name: string;
    specs: Record<string, unknown>;
    /** Product approved, supplier approved/preferred and active, and a current approved price exists. */
    eligible: boolean;
  };
}

export interface Finding { code: string; level: CompatLevel; params?: Record<string, string | number> }
export interface CompatResult { status: CompatLevel; findings: Finding[] }

const RANK: Record<CompatLevel, number> = { GREEN: 0, YELLOW: 1, RED: 2 };
export const worst = (levels: CompatLevel[]): CompatLevel =>
  levels.reduce<CompatLevel>((a, b) => (RANK[b] > RANK[a] ? b : a), 'GREEN');

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

export function evaluateCompatibility(
  spec: LiftSpec, pkg: PackageEligibility, components: SelectedComponent[], rules: CompatParams,
): CompatResult {
  const f: Finding[] = [];
  const add = (level: CompatLevel, code: string, params?: Finding['params']) => f.push({ code, level, params });
  const by = (c: ComponentCategory) => components.find((x) => x.slotCategory === c)?.product ?? null;

  // 1. Measurements: missing values cannot be validated → engineer must review.
  const required: Array<[keyof LiftSpec, string]> = [
    ['ratedLoadKg', 'ratedLoadKg'], ['speedMps', 'speedMps'], ['stops', 'stops'], ['shaftWidthMm', 'shaftWidthMm'],
    ['shaftDepthMm', 'shaftDepthMm'], ['pitDepthMm', 'pitDepthMm'], ['overheadMm', 'overheadMm'],
  ];
  for (const [key, field] of required) if (spec[key] === null) add('YELLOW', 'MEASUREMENT_MISSING', { field });
  if (spec.source === 'DECLARED') add('YELLOW', 'DIMENSIONS_NOT_SURVEYED');

  const load = spec.ratedLoadKg; const speed = spec.speedMps; const stops = spec.stops;

  // 2. Rated load vs passengers.
  if (spec.persons !== null && load !== null && load < spec.persons * rules.kgPerPerson) {
    add('RED', 'LOAD_BELOW_PERSONS', { persons: spec.persons, required: spec.persons * rules.kgPerPerson, load });
  }

  // 3. Package technical eligibility.
  if (!pkg.eligiblePurposes.includes(spec.purpose)) add('RED', 'PACKAGE_PURPOSE', { purpose: spec.purpose });
  if (stops !== null && (stops < pkg.minStops || stops > pkg.maxStops)) add('RED', 'PACKAGE_STOPS', { stops, min: pkg.minStops, max: pkg.maxStops });
  if (speed !== null && speed > pkg.maxSpeedMps) add('RED', 'PACKAGE_SPEED', { speed, max: pkg.maxSpeedMps });
  if (load !== null && (load < pkg.minLoadKg || load > pkg.maxLoadKg)) add('RED', 'PACKAGE_LOAD', { load, min: pkg.minLoadKg, max: pkg.maxLoadKg });
  if (stops !== null && spec.floors !== null && stops > spec.floors + 1) add('YELLOW', 'STOPS_EXCEED_FLOORS', { stops, floors: spec.floors });
  if (speed !== null && speed > rules.reviewAboveSpeedMps) add('YELLOW', 'SPEED_REVIEW', { speed, limit: rules.reviewAboveSpeedMps });

  // 4. Every selected product must still be eligible; mandatory slots must be filled.
  for (const c of components) {
    if (c.product && !c.product.eligible) add('RED', 'PRODUCT_NOT_ELIGIBLE', { category: c.slotCategory, name: c.product.name });
    if (!c.product && c.isMandatory) add('RED', 'MANDATORY_COMPONENT_MISSING', { category: c.slotCategory });
  }
  for (const category of rules.requiredSafetyCategories) {
    if (!by(category as ComponentCategory)) add('RED', 'SAFETY_COMPONENT_MISSING', { category });
  }

  // 5. Machine (motor).
  const machine = by('MACHINE');
  const driveType = machine ? (machine.specs.driveType as string | undefined) : undefined;
  if (machine) {
    const maxLoad = num(machine.specs.maxLoadKg); const maxSpeed = num(machine.specs.maxSpeedMps); const kw = num(machine.specs.powerKw);
    if (maxLoad === null || maxSpeed === null || kw === null) add('YELLOW', 'SPEC_INCOMPLETE', { category: 'MACHINE' });
    if (maxLoad !== null && load !== null && load > maxLoad) add('RED', 'MOTOR_LOAD', { load, max: maxLoad });
    if (maxSpeed !== null && speed !== null && speed > maxSpeed) add('RED', 'MOTOR_SPEED', { speed, max: maxSpeed });
    if (kw !== null && kw > rules.threePhaseAboveKw) {
      if (spec.powerSupply === 'SINGLE_PHASE') add('RED', 'POWER_THREE_PHASE_REQUIRED', { kw });
      else if (spec.powerSupply === 'UNKNOWN') add('YELLOW', 'POWER_SUPPLY_UNKNOWN', { kw });
    }
  }

  // 6. Controller.
  const controller = by('CONTROLLER');
  if (controller) {
    const maxStops = num(controller.specs.maxStops); const maxSpeed = num(controller.specs.maxSpeedMps);
    const drives = Array.isArray(controller.specs.supportedDrives) ? (controller.specs.supportedDrives as string[]) : null;
    if (maxStops === null || maxSpeed === null || !drives) add('YELLOW', 'SPEC_INCOMPLETE', { category: 'CONTROLLER' });
    if (maxStops !== null && stops !== null && stops > maxStops) add('RED', 'CONTROLLER_STOPS', { stops, max: maxStops });
    if (maxSpeed !== null && speed !== null && speed > maxSpeed) add('RED', 'CONTROLLER_SPEED', { speed, max: maxSpeed });
    if (drives && driveType && !drives.includes(driveType)) add('RED', 'CONTROLLER_DRIVE', { drive: driveType });
  }

  // 7. Cabin must fit the shaft and carry the rated load.
  const cabin = by('CAR_CABIN');
  const carWidth = cabin ? num(cabin.specs.carWidthMm) : null;
  if (cabin) {
    const carDepth = num(cabin.specs.carDepthMm); const cabinLoad = num(cabin.specs.ratedLoadKg);
    if (carWidth === null || carDepth === null || cabinLoad === null) add('YELLOW', 'SPEC_INCOMPLETE', { category: 'CAR_CABIN' });
    if (carWidth !== null && spec.shaftWidthMm !== null && carWidth + rules.sideClearanceMm > spec.shaftWidthMm) {
      add('RED', 'CABIN_WIDTH', { need: carWidth + rules.sideClearanceMm, shaft: spec.shaftWidthMm });
    }
    if (carDepth !== null && spec.shaftDepthMm !== null && carDepth + rules.depthClearanceMm > spec.shaftDepthMm) {
      add('RED', 'CABIN_DEPTH', { need: carDepth + rules.depthClearanceMm, shaft: spec.shaftDepthMm });
    }
    if (cabinLoad !== null && load !== null && load > cabinLoad) add('RED', 'CABIN_LOAD', { load, max: cabinLoad });
  }

  // 8. Doors.
  const carDoor = by('CAR_DOOR'); const landingDoor = by('LANDING_DOOR');
  const carOpening = carDoor ? num(carDoor.specs.clearOpeningMm) : null;
  const landingOpening = landingDoor ? num(landingDoor.specs.clearOpeningMm) : null;
  if (carOpening !== null && carWidth !== null && carOpening > carWidth) add('RED', 'DOOR_WIDER_THAN_CABIN', { door: carOpening, cabin: carWidth });
  if (spec.accessibility || spec.purpose === 'ACCESSIBLE') {
    for (const opening of [carOpening, landingOpening]) {
      if (opening !== null && opening < rules.accessibleMinDoorMm) { add('RED', 'DOOR_NOT_ACCESSIBLE', { door: opening, min: rules.accessibleMinDoorMm }); break; }
    }
  }
  if (carOpening !== null && landingOpening !== null && carOpening !== landingOpening) add('YELLOW', 'DOOR_MISMATCH', { car: carOpening, landing: landingOpening });

  // 9. Pit and overhead for the speed band.
  if (speed !== null) {
    const bands = [...(rules.pitOverheadBands[spec.purpose] ?? rules.pitOverheadBands.DEFAULT)].sort((a, b) => a.maxSpeedMps - b.maxSpeedMps);
    const b = bands.find((x) => speed <= x.maxSpeedMps);
    if (!b) add('RED', 'SPEED_OUT_OF_RULES', { speed });
    else {
      if (spec.pitDepthMm !== null) {
        if (spec.pitDepthMm < b.reducedPitMm) add('RED', 'PIT_TOO_SHALLOW', { pit: spec.pitDepthMm, min: b.reducedPitMm });
        else if (spec.pitDepthMm < b.minPitMm) add('YELLOW', 'PIT_REDUCED', { pit: spec.pitDepthMm, min: b.minPitMm });
      }
      if (spec.overheadMm !== null) {
        if (spec.overheadMm < b.reducedOverheadMm) add('RED', 'OVERHEAD_TOO_LOW', { overhead: spec.overheadMm, min: b.reducedOverheadMm });
        else if (spec.overheadMm < b.minOverheadMm) add('YELLOW', 'OVERHEAD_REDUCED', { overhead: spec.overheadMm, min: b.minOverheadMm });
      }
    }
  }

  // 10. Safety components rated for the duty.
  for (const category of ['SAFETY_GEAR', 'GOVERNOR', 'BUFFERS'] as const) {
    const p = by(category);
    if (!p) continue;
    const maxSpeed = num(p.specs.maxSpeedMps);
    if (maxSpeed === null) add('YELLOW', 'SPEC_INCOMPLETE', { category });
    else if (speed !== null && speed > maxSpeed) add('RED', 'SAFETY_RATING_SPEED', { category, speed, max: maxSpeed });
    const maxLoad = num(p.specs.maxLoadKg);
    if (category === 'SAFETY_GEAR' && maxLoad !== null && load !== null && load > maxLoad) add('RED', 'SAFETY_RATING_LOAD', { load, max: maxLoad });
  }

  // De-duplicate identical findings (e.g. the same missing spec reported twice).
  const seen = new Set<string>();
  const findings = f.filter((x) => { const k = `${x.code}|${JSON.stringify(x.params ?? {})}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { status: worst(findings.map((x) => x.level)), findings };
}
