import { Badge, type Tone } from '@/components/ui';
import type { TFunction } from '@/i18n';
import type { SupplierScore } from '@/lib/supplier-score';

const pct = (v: number | null, na: string) => (v === null ? na : `${v}%`);

/** Advisory supplier performance score with its three components. */
export function SupplierScoreBadge({ t, score, detailed = false }: { t: TFunction; score: SupplierScore | null; detailed?: boolean }) {
  if (!score || score.score === null) return <span className="text-xs text-slate-500">{t('mk.po.noScore')}</span>;
  const tone: Tone = score.score >= 85 ? 'green' : score.score >= 60 ? 'amber' : 'red';
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Badge tone={tone}>{score.score} / 100</Badge>
      {detailed && <span className="text-xs text-slate-600">{t('mk.po.scoreParts', { ack: pct(score.ackRate, t('mk.po.na')), onTime: pct(score.onTimeRate, t('mk.po.na')), price: pct(score.priceAccuracy, t('mk.po.na')) })}</span>}
    </span>
  );
}
