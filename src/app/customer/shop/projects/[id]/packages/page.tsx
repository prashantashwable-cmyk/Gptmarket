import { notFound } from 'next/navigation';
import { Check, Minus, ShieldCheck } from 'lucide-react';
import { startConfigurationAction } from '@/app/actions/market';
import { CompatBadge, CompatPanel, PriceOrRequest } from '@/components/market/views';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/form';
import { isUuid, load, pageCtx } from '@/server/page';
import { getCatalogue } from '@/server/services/shop';

const TIER_STYLE: Record<string, string> = {
  BASIC: 'from-slate-100 to-slate-200', STANDARD: 'from-sky-100 to-slate-200', PREMIUM: 'from-slate-200 to-slate-400', LUXURY: 'from-amber-100 to-amber-300',
};

export default async function PackageCatalogue({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { ctx, t } = await pageCtx('customer');
  const packages = await load(() => getCatalogue(ctx, id));
  return (
    <>
      <PageHeader title={t('mk.cat.title')} subtitle={t('mk.cat.subtitle')} back={{ href: `/customer/shop/projects/${id}`, label: t('mk.proj.back') }} />
      {packages.length === 0 ? <EmptyState title={t('mk.cat.empty')} hint={t('mk.cat.emptyHint')} /> : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{packages.map((p) => {
          const included = p.slots.filter((s) => s.isMandatory);
          const editable = p.slots.filter((s) => s.customerEditable || !s.isMandatory).length;
          const blocked = p.compat?.status === 'RED';
          return (
            <li key={p.packageVersion.id}><Card className="flex h-full flex-col overflow-hidden">
              <div className={`bg-gradient-to-br ${TIER_STYLE[p.packageVersion.code] ?? ''} px-4 py-5`}>
                <p className="text-xs font-semibold tracking-wider text-slate-600 uppercase">{t(`e.packageCode.${p.packageVersion.code}`)}</p>
                <h2 className="text-lg font-bold text-slate-900">{p.packageVersion.title}</h2>
                <p className="mt-2 text-2xl font-bold text-slate-900"><PriceOrRequest t={t} value={p.totals?.totalPayable} status={p.pricingStatus} /></p>
                <p className="text-xs text-slate-700">{t('mk.cat.estimateNote')}</p>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4 text-sm">
                <div className="flex flex-wrap gap-2"><CompatBadge t={t} status={p.compat?.status} />
                  <Badge tone="blue">{t('mk.cat.warranty', { months: p.packageVersion.warrantyMonths })}</Badge>
                  {editable > 0 && <Badge tone="gray">{t('mk.cat.customisable', { count: editable })}</Badge>}</div>
                {p.packageVersion.features && <ul className="space-y-1">{String(p.packageVersion.features).split('\n').filter(Boolean).map((f) => (
                  <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />{f}</li>))}</ul>}
                <details><summary className="cursor-pointer font-medium text-brand-700">{t('mk.cat.included', { count: included.length })}</summary>
                  <ul className="mt-2 space-y-1 text-slate-700">{included.map((s) => {
                    const std = s.options.find((o) => o.productId === s.selectedProductId);
                    return <li key={s.slotId} className="flex gap-2">{s.isSafetyCritical ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" aria-label={t('mk.cart.safety')} /> : <Check className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />}
                      <span><span className="font-medium">{t(`e.componentCategory.${s.category}`)}</span>{std ? `: ${std.name}` : ''}</span></li>;
                  })}</ul></details>
                {p.packageVersion.exclusions && <details><summary className="cursor-pointer font-medium text-brand-700">{t('mk.cat.excluded')}</summary>
                  <ul className="mt-2 space-y-1 text-slate-700">{String(p.packageVersion.exclusions).split('\n').filter(Boolean).map((f) => (
                    <li key={f} className="flex gap-2"><Minus className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />{f}</li>))}</ul></details>}
                <details><summary className="cursor-pointer font-medium text-brand-700">{t('mk.cat.eligibility')}</summary><div className="mt-2"><CompatPanel t={t} compat={p.compat} compact /></div></details>
                <div className="mt-auto pt-2">
                  {blocked ? <Alert tone="red">{t('mk.cat.blocked')}</Alert> : (
                    <ActionForm action={startConfigurationAction} hideSuccess>
                      <input type="hidden" name="leadId" value={id} /><input type="hidden" name="packageVersionId" value={p.packageVersion.id} />
                      <SubmitButton className="w-full" size="lg">{t('mk.cat.choose')}</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </div>
            </Card></li>
          );
        })}</ul>
      )}
    </>
  );
}
