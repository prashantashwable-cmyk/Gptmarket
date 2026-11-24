import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download } from 'lucide-react';
import { engineeringDecisionAction, issueVersionAction, pricingDecisionAction } from '@/app/actions/market';
import { Timeline } from '@/components/common';
import { QuotationDocument } from '@/components/market/quotation-doc';
import { findingText } from '@/components/market/views';
import { Alert, Badge, PageHeader, Section, buttonClass } from '@/components/ui';
import { ActionForm, CheckboxField, Field, SubmitButton, TextareaField } from '@/components/ui/form';
import { formatDate, formatDateTime, formatINR } from '@/lib/format';
import { isUuid, load, pageCtx } from '@/server/page';
import { getMarketQuotation } from '@/server/services/market-quotes';

export default async function AdminMarketQuotation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { ctx, t, locale } = await pageCtx('admin');
  const { quotation: q, current: v, versions, approvals, costs, events } = await load(() => getMarketQuotation(ctx, id));
  if (!v) notFound();
  const cost = costs.find((c) => c.version_id === v.id);
  const yellow = (v.snapshot.compat.findings as Array<{ code: string; level: string; params?: Record<string, string | number> }>).filter((f) => f.level === 'YELLOW');
  const yellowCodes = [...new Set(yellow.map((f) => f.code))];
  const canEngineer = ctx.permissions.has('engineering.approve') && q.status === 'PENDING_ENGINEERING' && v.price_basis === 'FINAL';
  const canOwner = ctx.permissions.has('pricing.approve') && q.status === 'PENDING_OWNER_APPROVAL';
  const canReissue = ctx.permissions.has('market.quote') && !['ACCEPTED', 'CANCELLED'].includes(q.status);
  return (
    <>
      <PageHeader title={`${q.quotation_number} · v${v.version_no}`} subtitle={`${q.project_name} · ${q.lead_number} · ${q.config_number}`} back={{ href: '/admin/marketplace/quotations', label: t('mk.adm.quotations') }}
        actions={<>
          <Link href={`/admin/leads/${q.lead_id}`} className={buttonClass('secondary', 'sm')}>{t('mk.adm.openLead')}</Link>
          <a href={`/api/market/quotations/${id}/pdf`} className={buttonClass('secondary', 'sm')}><Download className="size-4" aria-hidden />{t('mk.quote.pdf')}</a>
        </>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2"><QuotationDocument t={t} locale={locale} quotation={q} version={v} approvals={approvals} /></div>
        <aside className="space-y-4">
          {cost && (
            <Section title={t('mk.adm.internal')} description={t('mk.adm.internalHint')}>
              <dl className="space-y-1 text-sm">
                {[['material', cost.material_cost], ['installation', cost.installation_cost], ['transport', cost.transport_cost], ['siteWork', cost.site_work_cost], ['project', cost.project_cost], ['overhead', cost.overhead_amount], ['margin', cost.margin_amount]].map(([k, val]) => (
                  <div key={k} className="flex justify-between gap-2"><dt className="text-slate-600">{t(`mk.adm.cost.${k}`)}</dt><dd className="tabular-nums">{formatINR(val)}</dd></div>
                ))}
                <div className="flex justify-between gap-2 font-semibold"><dt>{t('mk.adm.cost.marginPct')}</dt><dd className="tabular-nums">{Number(cost.margin_percent).toFixed(2)}%</dd></div>
              </dl>
              {cost.exceptions.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{cost.exceptions.map((e: string) => <Badge key={e} tone="red">{t(`mk.adm.exc.${e}`)}</Badge>)}</div>}
              {v.discount_reason && <p className="mt-2 text-xs text-slate-600">{t('mk.adm.discountReason')}: {v.discount_reason}</p>}
            </Section>
          )}
          {q.status === 'ESTIMATE' && <Alert tone="amber">{t('mk.adm.estimateHint')}</Alert>}
          {canEngineer && (
            <Section title={t('mk.adm.engTitle')} description={t('mk.adm.engHint')}>
              <ActionForm action={engineeringDecisionAction} className="space-y-3"><input type="hidden" name="versionId" value={v.id} />
                {yellowCodes.length > 0 && <fieldset className="space-y-1"><legend className="mb-1 text-sm font-medium">{t('mk.adm.acknowledge')}</legend>
                  {yellowCodes.map((c) => <CheckboxField key={c} name="acknowledged[]" value={c} label={findingText(t, yellow.find((f) => f.code === c)!)} />)}</fieldset>}
                <TextareaField name="note" label={t('mk.adm.engNote')} rows={3} required />
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="decision" value="APPROVED" variant="success">{t('a.approve')}</SubmitButton>
                  <SubmitButton name="decision" value="REJECTED" variant="danger" confirm={t('mk.adm.rejectConfirm')}>{t('a.reject')}</SubmitButton>
                </div>
              </ActionForm>
            </Section>
          )}
          {q.status === 'PENDING_ENGINEERING' && !canEngineer && <Alert tone="amber">{t('mk.adm.waitingEngineer')}</Alert>}
          {canOwner && (
            <Section title={t('mk.adm.ownerTitle')} description={t('mk.adm.ownerHint')}>
              <ActionForm action={pricingDecisionAction} className="space-y-3"><input type="hidden" name="versionId" value={v.id} />
                <TextareaField name="note" label={t('mk.adm.ownerNote')} rows={2} required />
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="decision" value="APPROVED" variant="success">{t('a.approve')}</SubmitButton>
                  <SubmitButton name="decision" value="REJECTED" variant="danger">{t('a.reject')}</SubmitButton>
                </div>
              </ActionForm>
            </Section>
          )}
          {canReissue && (
            <Section title={t('mk.adm.reissue')} description={t('mk.adm.reissueHint')}>
              <ActionForm action={issueVersionAction} className="space-y-2"><input type="hidden" name="id" value={id} />
                <Field name="discountPercent" label={t('mk.adm.discount')} defaultValue="0" inputMode="decimal" />
                <Field name="discountReason" label={t('mk.adm.discountReason')} />
                <SubmitButton size="sm" variant="secondary">{t('mk.adm.createVersion')}</SubmitButton>
              </ActionForm>
            </Section>
          )}
          <Section title={t('mk.adm.history')}>
            <ul className="space-y-1 text-sm">{versions.map((x) => (
              <li key={x.id} className="flex justify-between gap-2"><a href={`/api/market/quotations/${id}/pdf?version=${x.version_no}`} className="text-brand-700 hover:underline">v{x.version_no} · {t(`e.priceBasis.${x.price_basis}`)}</a>
                <span className="tabular-nums">{formatINR(x.total_payable)} <span className="text-xs text-slate-500">{formatDate(x.created_at, locale)}</span></span></li>
            ))}</ul>
          </Section>
          <Section title={t('mk.adm.events')}>
            <Timeline items={events.map((e, i) => ({ key: String(i), title: e.event_type, meta: `${formatDateTime(e.created_at, locale)}${e.actor ? ` · ${e.actor}` : ''}` }))} />
          </Section>
        </aside>
      </div>
    </>
  );
}
