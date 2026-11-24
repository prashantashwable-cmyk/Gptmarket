// Supplier performance score (brief section 8). Advisory only, computed from AIEC's own records:
// purchase-order acknowledgement speed, on-time delivery against the supplier's own promised date,
// and accuracy of price submissions. Pure function, no I/O.

export interface SupplierHistory {
  /** Purchase orders acknowledged (or dispatched) and how many of them within the target hours. */
  acknowledged: number; acknowledgedOnTime: number;
  /** Delivered purchase orders and how many arrived on or before the promised date. */
  delivered: number; deliveredOnTime: number;
  /** Reviewed price submissions and how many AIEC rejected. */
  pricesReviewed: number; pricesRejected: number;
}

export interface SupplierScore {
  /** 0–100, or null when there is not enough history to judge fairly. */
  score: number | null;
  ackRate: number | null; onTimeRate: number | null; priceAccuracy: number | null;
  samples: number;
}

export const SCORE_WEIGHTS = { onTime: 50, ack: 30, price: 20 } as const;
/** Minimum number of measured events before a score is shown. */
export const MIN_SAMPLES = 3;

const rate = (ok: number, total: number): number | null => (total > 0 ? Math.round((ok / total) * 100) : null);

export function supplierScore(h: SupplierHistory): SupplierScore {
  const ackRate = rate(h.acknowledgedOnTime, h.acknowledged);
  const onTimeRate = rate(h.deliveredOnTime, h.delivered);
  const priceAccuracy = rate(h.pricesReviewed - h.pricesRejected, h.pricesReviewed);
  const samples = h.acknowledged + h.delivered + h.pricesReviewed;
  // Weighted mean over the components that have data; weights re-normalise when one is missing.
  const parts: Array<[number | null, number]> = [[onTimeRate, SCORE_WEIGHTS.onTime], [ackRate, SCORE_WEIGHTS.ack], [priceAccuracy, SCORE_WEIGHTS.price]];
  const present = parts.filter(([v]) => v !== null) as Array<[number, number]>;
  const weight = present.reduce((s, [, w]) => s + w, 0);
  const score = samples >= MIN_SAMPLES && weight > 0 ? Math.round(present.reduce((s, [v, w]) => s + v * w, 0) / weight) : null;
  return { score, ackRate, onTimeRate, priceAccuracy, samples };
}
