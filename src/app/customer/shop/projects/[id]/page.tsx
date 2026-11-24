import Link from 'next/link';
import { notFound } from 'next/navigation';
import { updateSpecAction } from '@/app/actions/market';
import { FileLink } from '@/components/common';
import { SpecForm } from '@/components/market/spec-form';
import { SpecList } from '@/components/market/views';
import { Alert, Card, EmptyState, LinkButton, PageHeader, Section, StatusBadge } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { isUuid, load, pageCtx } from '@/server/page';
import { getShopProject } from '@/server/services/shop';

export default async function ShopProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { ctx, t, locale } = await pageCtx('customer');
  const { lead, spec, photos, configurations, survey, effective } = await load(() => getShopProject(ctx, id));
  return (
    <>
      <PageHeader title={lead.project_name} subtitle={`${lead.lead_number} · ${t(`zone.${lead.zone_code}`)}`} back={{ href: '/customer/shop', label: t('nav.liftShop') }}
        actions={<>
          {configurations.length > 1 && <LinkButton href={`/customer/shop/projects/${id}/compare`} variant="secondary" size="sm">{t('mk.proj.compare')}</LinkButton>}
          {spec && <LinkButton href={`/customer/shop/projects/${id}/packages`} size="sm">{t('mk.proj.browse')}</LinkButton>}
        </>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title={t('mk.proj.configurations')} description={t('mk.proj.configurationsHint')}>
            {configurations.length === 0 ? (
              <EmptyState title={t('mk.proj.noConfigs')} action={spec ? <LinkButton href={`/customer/shop/projects/${id}/packages`}>{t('mk.proj.browse')}</LinkButton> : undefined} />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">{configurations.map((c) => (
                <li key={c.id}><Link href={`/customer/shop/cart/${c.id}`} className="block"><Card className="h-full p-4 hover:shadow-md">
                  <p className="font-semibold text-slate-900">{c.name}</p>
                  <p className="text-sm text-slate-600">{c.package_title}</p>
                  <p className="mt-2 flex flex-wrap gap-2 text-xs"><StatusBadge value={c.status} label={t(`e.configStatus.${c.status}`)} />
                    {c.quotation_status && <StatusBadge value={c.quotation_status} label={t(`e.marketQuotationStatus.${c.quotation_status}`)} />}</p>
                  <p className="mt-2 text-xs text-slate-500">{c.config_number} · {formatDate(c.updated_at, locale)}</p>
                </Card></Link></li>
              ))}</ul>
            )}
          </Section>
          <Section title={t('mk.proj.spec')}>
            {effective ? <SpecList t={t} spec={effective.spec} /> : <Alert tone="amber">{t('mk.proj.noSpec')}</Alert>}
            {effective?.spec.source === 'DECLARED' && <Alert tone="amber" className="mt-3">{t('mk.proj.declaredNote')}</Alert>}
            <details className="mt-4 rounded-lg border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-medium text-brand-700">{t('mk.proj.edit')}</summary>
              <div className="mt-3"><SpecForm action={updateSpecAction} mode="edit" leadId={id} spec={spec} /></div>
            </details>
          </Section>
        </div>
        <div className="space-y-5">
          <Section title={t('mk.proj.survey')}>
            {survey ? (
              <p className="text-sm"><StatusBadge value={survey.status} label={t(`e.surveyStatus.${survey.status}`)} />
                <span className="mt-1 block text-slate-600">{formatDate(survey.scheduled_at, locale)}</span></p>
            ) : <p className="text-sm text-slate-600">{t('mk.proj.surveyPending')}</p>}
            <p className="mt-2 text-xs text-slate-500">{t('mk.proj.surveyHint')}</p>
          </Section>
          <Section title={t('mk.proj.photos')}>
            {photos.length === 0 ? <p className="text-sm text-slate-600">{t('common.noData')}</p> : (
              <ul className="space-y-1 text-sm">{photos.map((p, i) => <li key={p.id}><FileLink id={p.file_id} label={t('mk.proj.photo', { n: i + 1 })} /></li>)}</ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
