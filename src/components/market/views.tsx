import type { ReactNode } from 'react';
import { CircleCheck, CircleAlert, CircleX, ShieldCheck } from 'lucide-react';
import { Alert, Badge, type Tone } from '@/components/ui';
import type { TFunction } from '@/i18n';
import type { CompatResult, LiftSpec } from '@/lib/compatibility';
import { cn, formatINR, formatNumber } from '@/lib/format';

const LEVEL_TONE: Record<string, Tone> = { GREEN: 'green', YELLOW: 'amber', RED: 'red' };

export function CompatBadge({ t, status }: { t: TFunction; status: string | null | undefined }) {
  if (!status) return <Badge tone="gray">{t('mk.compat.notConfigured')}</Badge>;
  return <Badge tone={LEVEL_TONE[status] ?? 'gray'}>{t(`e.compatLevel.${status}`)}</Badge>;
}

/** Translated finding text. Codes are stable; parameters are numbers or enum codes. */
export function findingText(t: TFunction, f: { code: string; params?: Record<string, string | number> }): string {
  const p = { ...(f.params ?? {}) } as Record<string, string | number>;
  if (typeof p.category === 'string') p.category = t(`e.componentCategory.${p.category}`);
  if (typeof p.purpose === 'string') p.purpose = t(`e.liftPurpose.${p.purpose}`);
  if (typeof p.field === 'string') p.field = t(`mk.spec.${p.field}`);
  return t(`mk.finding.${f.code}`, p);
}

export function CompatPanel({ t, compat, compact = false }: { t: TFunction; compat: CompatResult | null; compact?: boolean }) {
  if (!compat) return <Alert tone="red">{t('mk.compat.notConfiguredHint')}</Alert>;
  const Icon = compat.status === 'GREEN' ? CircleCheck : compat.status === 'YELLOW' ? CircleAlert : CircleX;
  const tone = LEVEL_TONE[compat.status];
  const order = { RED: 0, YELLOW: 1, GREEN: 2 } as const;
  const findings = [...compat.findings].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <div className={cn('rounded-lg border p-3 text-sm', tone === 'green' ? 'border-emerald-200 bg-emerald-50' : tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50')}>
      <p className="flex items-center gap-2 font-semibold text-slate-900">
        <Icon className={cn('size-5', tone === 'green' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-red-600')} aria-hidden />
        {t(`mk.compat.title.${compat.status}`)}
      </p>
      <p className="mt-1 text-slate-700">{t(`mk.compat.hint.${compat.status}`)}</p>
      {findings.length > 0 && (
        <ul className={cn('mt-2 space-y-1', compact && 'max-h-40 overflow-y-auto')}>
          {findings.map((f, i) => (
            <li key={`${f.code}-${i}`} className="flex flex-wrap items-start gap-x-2 gap-y-0.5">
              <Badge tone={LEVEL_TONE[f.level]} className="mt-0.5 shrink-0">{t(`e.compatLevel.${f.level}`)}</Badge>
              <span className="min-w-0 flex-1 basis-48 text-slate-800">{findingText(t, f)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600"><ShieldCheck className="size-3.5" aria-hidden />{t('mk.compat.engineerNote')}</p>
    </div>
  );
}

export interface Totals {
  charges: { materials: string; installation: string; transport: string; siteWork: string };
  sellingBeforeDiscount: string; discountPercent: string; discountAmount: string; sellingPrice: string; gstPercent: string; gstAmount: string; totalPayable: string;
}

function Row({ label, value, strong, muted }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1', strong && 'border-t border-slate-200 pt-2 text-base font-semibold text-slate-900', muted && 'text-slate-600')}>
      <dt>{label}</dt><dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** Customer-facing price summary. `basis` distinguishes an estimate from an AIEC-approved final price. */
export function PriceSummary({ t, totals, basis }: { t: TFunction; totals: Totals; basis: 'ESTIMATED' | 'FINAL' | 'LIVE' }) {
  const discount = Number(totals.discountAmount) > 0;
  return (
    <div>
      <dl className="text-sm">
        <Row label={t('mk.price.materials')} value={formatINR(totals.charges.materials)} />
        <Row label={t('mk.price.installation')} value={formatINR(totals.charges.installation)} />
        <Row label={t('mk.price.transport')} value={formatINR(totals.charges.transport)} />
        <Row label={t('mk.price.siteWork')} value={formatINR(totals.charges.siteWork)} />
        {discount && <Row label={t('mk.price.discount', { percent: Number(totals.discountPercent) })} value={`− ${formatINR(totals.discountAmount)}`} />}
        <Row label={t('mk.price.subtotal')} value={formatINR(totals.sellingPrice)} muted />
        <Row label={t('mk.price.gst', { percent: Number(totals.gstPercent) })} value={formatINR(totals.gstAmount)} muted />
        <Row label={basis === 'FINAL' ? t('mk.price.totalFinal') : t('mk.price.totalEstimated')} value={formatINR(totals.totalPayable)} strong />
      </dl>
      <p className={cn('mt-2 rounded-md px-2 py-1.5 text-xs', basis === 'FINAL' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-950')}>
        {t(`mk.price.basis.${basis}`)}
      </p>
    </div>
  );
}

export function SpecList({ t, spec }: { t: TFunction; spec: LiftSpec }) {
  const mm = (v: number | null) => (v === null ? '—' : `${formatNumber(v)} mm`);
  const items: Array<[string, ReactNode]> = [
    ['purpose', t(`e.liftPurpose.${spec.purpose}`)],
    ['persons', spec.persons ?? '—'], ['ratedLoadKg', spec.ratedLoadKg === null ? '—' : `${spec.ratedLoadKg} kg`],
    ['speedMps', spec.speedMps === null ? '—' : `${spec.speedMps} m/s`], ['floors', spec.floors ?? '—'], ['stops', spec.stops ?? '—'],
    ['shaftWidthMm', mm(spec.shaftWidthMm)], ['shaftDepthMm', mm(spec.shaftDepthMm)], ['pitDepthMm', mm(spec.pitDepthMm)], ['overheadMm', mm(spec.overheadMm)],
    ['powerSupply', t(`e.powerSupply.${spec.powerSupply}`)], ['accessibility', spec.accessibility ? t('common.yes') : t('common.no')],
  ];
  return (
    <div>
      <Badge tone={spec.source === 'SURVEYED' ? 'green' : 'amber'}>{t(`e.specSource.${spec.source}`)}</Badge>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        {items.map(([k, v]) => (
          <div key={k}><dt className="text-xs text-slate-500">{t(`mk.spec.${k}`)}</dt><dd className="font-medium text-slate-900">{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}

export function PriceOrRequest({ t, value, status }: { t: TFunction; value: string | null | undefined; status: string }) {
  if (status !== 'OK' || !value) return <span className="text-sm font-medium text-slate-600">{t(`mk.pricingStatus.${status}`)}</span>;
  return <span className="tabular-nums">{formatINR(value)}</span>;
}
