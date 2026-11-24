import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CompatBadge, PriceOrRequest } from '@/components/market/views';
import { EmptyState, PageHeader, Section } from '@/components/ui';
import { COMPONENT_CATEGORY } from '@/lib/enums';
import { formatINR } from '@/lib/format';
import { isUuid, load, pageCtx } from '@/server/page';
import { compareConfigurations } from '@/server/services/shop';

export default async function CompareConfigurations({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { ctx, t } = await pageCtx('customer');
  const rows = await load(() => compareConfigurations(ctx, id));
  const categories = COMPONENT_CATEGORY.filter((c) => rows.some((r) => r.view.slots.some((s) => s.category === c)));
  return (
    <>
      <PageHeader title={t('mk.proj.compare')} subtitle={t('mk.cmp.subtitle')} back={{ href: `/customer/shop/projects/${id}`, label: t('mk.proj.back') }} />
      {rows.length === 0 ? <EmptyState title={t('mk.proj.noConfigs')} /> : (
        <Section>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-slate-200 text-left">
                <th className="py-2 pr-3 font-medium text-slate-500">{t('mk.cmp.item')}</th>
                {rows.map((r) => <th key={r.config.id} className="px-3 py-2 align-bottom"><Link href={`/customer/shop/cart/${r.config.id}`} className="font-semibold text-brand-700 hover:underline">{r.config.name}</Link>
                  <span className="block text-xs font-normal text-slate-500">{r.view.packageVersion.title}</span></th>)}
              </tr></thead>
              <tbody>
                <tr className="border-b border-slate-100 bg-slate-50 font-semibold"><td className="py-2 pr-3">{t('mk.price.totalEstimated')}</td>
                  {rows.map((r) => <td key={r.config.id} className="px-3 py-2"><PriceOrRequest t={t} value={r.view.totals?.totalPayable} status={r.view.pricingStatus} /></td>)}</tr>
                <tr className="border-b border-slate-100"><td className="py-2 pr-3">{t('mk.cmp.compat')}</td>
                  {rows.map((r) => <td key={r.config.id} className="px-3 py-2"><CompatBadge t={t} status={r.view.compat?.status} /></td>)}</tr>
                <tr className="border-b border-slate-100"><td className="py-2 pr-3">{t('mk.cmp.warranty')}</td>
                  {rows.map((r) => <td key={r.config.id} className="px-3 py-2">{t('mk.cat.warranty', { months: r.view.packageVersion.warrantyMonths })}</td>)}</tr>
                {categories.map((c) => (
                  <tr key={c} className="border-b border-slate-100 align-top"><td className="py-2 pr-3 text-slate-600">{t(`e.componentCategory.${c}`)}</td>
                    {rows.map((r) => {
                      const s = r.view.slots.find((x) => x.category === c);
                      const o = s?.options.find((x) => x.productId === s.selectedProductId);
                      return <td key={r.config.id} className="px-3 py-2">{o ? <>{o.name}<span className="block text-xs text-slate-500">{o.brand} {o.model}{s?.line && Number(s.line.upgradeCharge) > 0 ? ` · +${formatINR(s.line.upgradeCharge)}` : ''}</span></> : '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}
