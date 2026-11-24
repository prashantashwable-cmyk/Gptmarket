import Link from 'next/link';
import { CircleAlert, CircleX } from 'lucide-react';
import { LinkButton, PageHeader, Section, Stat } from '@/components/ui';
import { formatINR } from '@/lib/format';
import { load, pageCtx } from '@/server/page';
import { getMarketOverview } from '@/server/services/market-admin';

export default async function MarketplaceOverview() {
  const { ctx, t } = await pageCtx('admin');
  const { kpis: k, exceptions } = await load(() => getMarketOverview(ctx));
  const marginPct = Number(k.margin_base) > 0 ? ((Number(k.gross_margin) / Number(k.margin_base)) * 100).toFixed(1) : null;
  const links = [
    { href: '/admin/marketplace/quotations', label: t('mk.adm.quotations'), perm: 'market.view' },
    { href: '/admin/marketplace/catalogue', label: t('mk.adm.catalogue'), perm: 'catalogue.approve' },
    { href: '/admin/marketplace/packages', label: t('mk.adm.packages'), perm: 'package.manage' },
    { href: '/admin/marketplace/rules', label: t('mk.adm.rules'), perm: 'pricing.manage' },
  ].filter((l) => ctx.permissions.has(l.perm) || (l.perm === 'pricing.manage' && (ctx.permissions.has('pricing.approve') || ctx.permissions.has('engineering.approve'))));
  return (
    <>
      <PageHeader title={t('nav.marketplace')} subtitle={t('mk.adm.subtitle')}
        actions={links.map((l) => <LinkButton key={l.href} href={l.href} size="sm" variant="secondary">{l.label}</LinkButton>)} />
      <Section title={t('mk.adm.exceptions')} description={t('mk.adm.exceptionsHint')}>
        {exceptions.length === 0 ? <p className="text-sm text-emerald-800">{t('mk.adm.noExceptions')}</p> : (
          <ul className="grid gap-2 sm:grid-cols-2">{exceptions.map((e) => (
            <li key={e.kind}><Link href={e.href} className={`flex items-start gap-3 rounded-lg border p-3 hover:shadow-sm ${e.severity === 'red' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
              {e.severity === 'red' ? <CircleX className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden /> : <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />}
              <span><span className="font-semibold text-slate-900">{t(`mk.exc.${e.kind}`, { count: e.count })}</span><span className="block text-xs text-slate-700">{t(`mk.excHint.${e.kind}`)}</span></span>
            </Link></li>
          ))}</ul>
        )}
      </Section>
      <h2 className="mt-6 mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">{t('mk.adm.business')}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('mk.kpi.projects')} value={k.projects} />
        <Stat label={t('mk.kpi.configurations')} value={k.new_configurations} hint={t('mk.kpi.last30')} />
        <Stat label={t('mk.kpi.pending')} value={k.quotations_pending} hint={t('mk.kpi.issued', { count: k.quotations_issued })} />
        <Stat label={t('mk.kpi.accepted')} value={k.accepted} hint={t('mk.kpi.split', { aiec: k.accepted_aiec, market: k.accepted_marketplace })} />
        <Stat label={t('mk.kpi.acceptedValue')} value={formatINR(k.accepted_value)} hint={t('mk.kpi.exGst')} />
        <Stat label={t('mk.kpi.grossMargin')} value={formatINR(k.gross_margin)} hint={marginPct ? t('mk.kpi.marginPct', { percent: marginPct }) : undefined} />
      </div>
      <h2 className="mt-6 mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">{t('mk.adm.marketplace')}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('mk.kpi.suppliers')} value={k.active_suppliers} />
        <Stat label={t('mk.kpi.products')} value={k.approved_products} />
        <Stat label={t('mk.kpi.packages')} value={k.published_packages} />
      </div>
      <p className="mt-4 text-xs text-slate-600">{t('mk.adm.opsNote')} <Link href="/admin" className="font-medium text-brand-700 hover:underline">{t('nav.dashboard')}</Link></p>
    </>
  );
}
