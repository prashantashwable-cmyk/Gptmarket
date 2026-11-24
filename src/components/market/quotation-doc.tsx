import { CompatPanel, PriceSummary, SpecList } from '@/components/market/views';
import { Alert, Badge, Section, StatusBadge } from '@/components/ui';
import type { TFunction } from '@/i18n';
import { percentOf, fromPaise, toPaise } from '@/lib/commission';
import type { Locale } from '@/lib/enums';
import { formatDate, formatINR } from '@/lib/format';
import type { Rec } from '@/server/db';

type Line = { slotId: string; category: string; kind: string | null; isSafetyCritical: boolean; productName: string; brand: string; model: string; supplierName: string; warrantyMonths: number; deliveryDays: number; quantity: number; customerPrice: string; upgradeCharge: string };

/** Splits the payable total over the milestones; the last milestone absorbs the paisa rounding. */
function milestoneAmounts(total: string, milestones: Array<{ name: string; percent: number }>) {
  const totalP = toPaise(total);
  let used = 0n;
  return milestones.map((m, i) => {
    const amount = i === milestones.length - 1 ? totalP - used : percentOf(totalP, BigInt(Math.round(m.percent * 10000)));
    used += amount;
    return { ...m, amount: fromPaise(amount) };
  });
}

/** Customer-facing quotation (screen 8). Shows only snapshot data: never live prices, costs or margins. */
export function QuotationDocument({ t, locale, quotation, version, approvals }: { t: TFunction; locale: Locale; quotation: Rec; version: Rec; approvals: Rec[] }) {
  const snap = version.snapshot as Rec;
  const lines = snap.lines as Line[];
  const totals = {
    charges: { materials: version.charge_materials, installation: version.charge_installation, transport: version.charge_transport, siteWork: version.charge_site_work },
    sellingBeforeDiscount: version.selling_before_discount, discountPercent: version.discount_percent, discountAmount: version.discount_amount, sellingPrice: version.selling_price,
    gstPercent: version.gst_percent, gstAmount: version.gst_amount, totalPayable: version.total_payable,
  };
  const mine = approvals.filter((a) => a.version_id === version.id);
  const eng = mine.find((a) => a.kind === 'ENGINEERING');
  return (
    <div className="space-y-5">
      <Section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{t('mk.quote.doc')}</p>
            <p className="text-xl font-bold text-slate-900">{quotation.quotation_number} · v{version.version_no}</p>
            <p className="text-sm text-slate-600">{t('mk.quote.issued', { date: formatDate(version.created_at, locale) })} · {t('mk.quote.validUntil', { date: formatDate(version.valid_until, locale) })}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge value={quotation.status} label={t(`e.marketQuotationStatus.${quotation.status}`)} />
            <Badge tone={version.price_basis === 'FINAL' ? 'green' : 'amber'}>{t(`e.priceBasis.${version.price_basis}`)}</Badge>
          </div>
        </div>
        {version.price_basis === 'ESTIMATED' && <Alert tone="amber" className="mt-3">{t('mk.quote.estimateNote')}</Alert>}
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">{t('mk.quote.customer')}</dt><dd className="font-medium">{snap.customer.name} · {snap.customer.phone}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('mk.quote.project')}</dt><dd className="font-medium">{snap.project.projectName} ({snap.project.leadNumber})</dd>
            <dd className="text-slate-600">{snap.project.address} · {t(`zone.${snap.project.zoneCode}`)}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('mk.quote.package')}</dt><dd className="font-medium">{snap.package.title} · v{snap.package.versionNo}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('mk.quote.rules')}</dt><dd className="text-slate-700">{t('mk.quote.rulesValue', { p: snap.rules.pricingVersion, c: snap.rules.compatibilityVersion })}</dd></div>
        </dl>
      </Section>

      <Section title={t('mk.quote.spec')}><SpecList t={t} spec={snap.spec} /></Section>

      <Section title={t('mk.quote.breakdown')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-2 pr-2">{t('mk.quote.component')}</th><th className="px-2">{t('mk.quote.supplier')}</th><th className="px-2">{t('mk.quote.qty')}</th>
              <th className="px-2">{t('mk.quote.warranty')}</th><th className="px-2 text-right">{t('mk.quote.price')}</th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.slotId} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-2"><span className="font-medium text-slate-900">{t(`e.componentCategory.${l.category}`)}</span>
                  <span className="block text-slate-700">{l.productName}</span><span className="block text-xs text-slate-500">{l.brand} {l.model}{l.kind ? ` · ${t(`e.optionKind.${l.kind}`)}` : ''}{l.isSafetyCritical ? ` · ${t('mk.cart.safety')}` : ''}</span></td>
                <td className="px-2 py-2 text-slate-700">{l.supplierName}</td>
                <td className="px-2 py-2 tabular-nums">{l.quantity}</td>
                <td className="px-2 py-2">{t('mk.cart.warranty', { months: l.warrantyMonths })}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatINR(l.customerPrice)}{Number(l.upgradeCharge) > 0 && <span className="block text-xs text-amber-700">{t('mk.quote.upgradeIncl', { amount: formatINR(l.upgradeCharge) })}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-5 md:grid-cols-2">
        <Section title={t('mk.quote.charges')}><PriceSummary t={t} totals={totals} basis={version.price_basis} /></Section>
        <Section title={t('mk.quote.milestones')}>
          <ul className="divide-y divide-slate-100 text-sm">{milestoneAmounts(version.total_payable, snap.paymentMilestones).map((m) => (
            <li key={m.name} className="flex justify-between gap-2 py-1.5"><span>{m.name} <span className="text-slate-500">({m.percent}%)</span></span><span className="tabular-nums">{formatINR(m.amount)}</span></li>
          ))}</ul>
          <p className="mt-2 text-xs text-slate-600">{t('mk.quote.milestonesNote')}</p>
        </Section>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Section title={t('mk.quote.warrantyTitle')}>
          <p className="text-sm">{t('mk.quote.warrantyText', { months: snap.package.warrantyMonths })}</p>
          {snap.package.exclusions && <><p className="mt-3 text-sm font-medium">{t('mk.cat.excluded')}</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">{String(snap.package.exclusions).split('\n').filter(Boolean).map((x: string) => <li key={x}>{x}</li>)}</ul></>}
          <p className="mt-3 text-xs text-slate-600">{t('mk.quote.statutory')}</p>
        </Section>
        <Section title={t('mk.quote.technical')}>
          <CompatPanel t={t} compat={snap.compat} compact />
          <p className="mt-3 text-sm">{eng ? t(`mk.quote.eng.${eng.decision}`, { name: eng.decided_by_name, date: formatDate(eng.created_at, locale) }) : version.price_basis === 'FINAL' ? t('mk.quote.eng.PENDING') : t('mk.quote.eng.SURVEY')}</p>
          {eng?.note && <p className="mt-1 text-xs text-slate-600">“{eng.note}”</p>}
        </Section>
      </div>
    </div>
  );
}
