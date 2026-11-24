import type { Locale } from './enums';

/** Owner-entered text with optional Hindi / Marathi versions (`field_hi`, `field_mr`); falls back to English. */
export function localized(row: Record<string, unknown> | null | undefined, field: string, locale: Locale): string | null {
  if (!row) return null;
  const v = locale === 'en' ? null : row[`${field}_${locale}`];
  const text = typeof v === 'string' && v.trim() ? v : row[field];
  return typeof text === 'string' ? text : null;
}
