import Link from 'next/link';
import { CirclePlus, ClipboardList, FileText, HardHat, LifeBuoy, PackageCheck } from 'lucide-react';
import { Card, EmptyState, LinkButton, PageHeader, Section, StatusBadge } from '@/components/ui';
import { formatDate, formatINR } from '@/lib/format';
import { load, pageCtx } from '@/server/page';
import { getShopHome } from '@/server/services/shop';

export default async function ShopHome() {
  const { ctx, t, locale } = await pageCtx('customer');
  const { projects, quotations, legacy } = await load(() => getShopHome(ctx));
  const tiles = [
    { href: '/customer/shop/new', icon: CirclePlus, title: t('mk.home.create'), hint: t('mk.home.createHint'), primary: true },
    { href: '#projects', icon: ClipboardList, title: t('mk.home.projects'), hint: t('mk.home.count', { count: projects.length }) },
    { href: '#quotations', icon: FileText, title: t('mk.home.quotations'), hint: t('mk.home.count', { count: quotations.length }) },
    { href: '/customer', icon: PackageCheck, title: t('mk.home.orders'), hint: t('mk.home.ordersHint') },
    { href: '/customer', icon: HardHat, title: t('mk.home.track'), hint: t('mk.home.trackHint') },
    { href: '/customer/service', icon: LifeBuoy, title: t('mk.home.support'), hint: t('mk.home.supportHint') },
  ];
  return (
    <>
      <PageHeader title={t('mk.home.welcome', { name: ctx.name })} subtitle={t('mk.home.subtitle')} />
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">{tiles.map(({ href, icon: Icon, title, hint, primary }) => (
        <li key={title}>
          <Link href={href} className={`flex h-full min-h-24 flex-col justify-between rounded-xl border p-4 shadow-sm transition-shadow hover:shadow-md ${primary ? 'border-brand-600 bg-brand-600 text-on-brand' : 'border-slate-200 bg-surface'}`}>
            <Icon className={`size-6 ${primary ? '' : 'text-brand-600'}`} aria-hidden />
            <span><span className="block font-semibold">{title}</span><span className={`block text-xs ${primary ? 'opacity-90' : 'text-slate-600'}`}>{hint}</span></span>
          </Link>
        </li>
      ))}</ul>

      <Section title={t('mk.home.projects')} className="mt-6">
        <div id="projects" />
        {projects.length === 0 ? (
          <EmptyState title={t('mk.home.noProjects')} hint={t('mk.home.noProjectsHint')} action={<LinkButton href="/customer/shop/new">{t('mk.home.create')}</LinkButton>} />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">{projects.map((p) => (
            <li key={p.id}><Link href={`/customer/shop/projects/${p.id}`} className="block">
              <Card className="h-full p-4 transition-shadow hover:shadow-md">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold text-slate-900">{p.project_name}</p>
                  <StatusBadge value={p.status} label={t(`e.leadStatus.${p.status}`)} />
                </div>
                <p className="mt-1 text-sm text-slate-600">{t(`e.liftPurpose.${p.purpose}`)}{p.stops ? ` · ${t('mk.home.stops', { count: p.stops })}` : ''}</p>
                <p className="mt-2 text-xs text-slate-500">{p.lead_number} · {formatDate(p.created_at, locale)} · {t('mk.home.configs', { count: p.configurations })}</p>
                {p.execution_model && <p className="mt-1 text-xs font-medium text-brand-700">{t(`e.executionModel.${p.execution_model}`)}</p>}
              </Card>
            </Link></li>
          ))}</ul>
        )}
      </Section>

      <Section title={t('mk.home.quotations')} className="mt-6">
        <div id="quotations" />
        {quotations.length === 0 ? <EmptyState title={t('mk.home.noQuotes')} /> : (
          <ul className="divide-y divide-slate-200">{quotations.map((q) => (
            <li key={q.id}><Link href={`/customer/shop/quotations/${q.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-slate-50">
              <span><span className="font-medium text-slate-900">{q.quotation_number}</span><span className="block text-xs text-slate-600">{q.project_name}</span></span>
              <span className="flex items-center gap-3">
                <span className="text-right text-sm tabular-nums">{formatINR(q.total_payable)}<span className="block text-xs text-slate-500">{t(`e.priceBasis.${q.price_basis}`)}</span></span>
                <StatusBadge value={q.status} label={t(`e.marketQuotationStatus.${q.status}`)} />
              </span>
            </Link></li>
          ))}</ul>
        )}
      </Section>
      {legacy > 0 && <p className="mt-4 text-sm text-slate-600">{t('mk.home.legacy', { count: legacy })} <Link href="/customer" className="font-medium text-brand-700 hover:underline">{t('nav.myProjects')}</Link></p>}
    </>
  );
}
