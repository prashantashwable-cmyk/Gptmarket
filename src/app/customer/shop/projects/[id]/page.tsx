import { localized } from '@/lib/localized';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { recordPaymentAction, updateSpecAction } from '@/app/actions/market';
import { FileLink } from '@/components/common';
import { SpecForm } from '@/components/market/spec-form';
import { SpecList } from '@/components/market/views';
import { Alert, Card, EmptyState, LinkButton, PageHeader, Section, StatusBadge } from '@/components/ui';
import { CUSTOMER_PAYMENT_MODE } from '@/lib/enums';
import { formatDate, formatINR, isoDateIST } from '@/lib/format';
import { ActionForm, Field, SelectField, SubmitButton } from '@/components/ui/form';
import { isUuid, load, pageCtx } from '@/server/page';
import { getMyAiecBilling } from '@/server/services/aiec-contract';
import { getShopProject } from '@/server/services/shop';

export default async function ShopProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { ctx, t, locale } = await pageCtx('customer');
  const { lead, spec, photos, configurations, survey, effective } = await load(() => getShopProject(ctx, id));
  const billing = await load(() => getMyAiecBilling(ctx, id));
  const modes = CUSTOMER_PAYMENT_MODE.filter((m) => m !== 'GATEWAY').map((m) => ({ value: m, label: t(`e.customerPaymentMode.${m}`) }));
  return (
    <>
      <PageHeader title={lead.project_name} subtitle={`${lead.lead_number} · ${t(`zone.${lead.zone_code}`)}`} back={{ href: '/customer/shop', label: t('nav.liftShop') }}
        actions={<>
          {configurations.length > 1 && <LinkButton href={`/customer/shop/projects/${id}/compare`} variant="secondary" size="sm">{t('mk.proj.compare')}</LinkButton>}
          {spec && <LinkButton href={`/customer/shop/projects/${id}/packages`} size="sm">{t('mk.proj.browse')}</LinkButton>}
        </>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {billing.order && (
            <Section title={t('mk.aiec.billingTitle')} description={t('mk.aiec.billingHint', { partner: billing.order.partner_name })}
              actions={<StatusBadge value={billing.order.status} label={t(`e.orderStatus.${billing.order.status}`)} />}>
              <p className="text-sm">{billing.order.order_number} · {t('mk.aiec.contractValue')}: <span className="font-semibold tabular-nums">{formatINR(billing.order.gross_order_value, locale)}</span>
                {' · '}<Link href={`/customer/projects/${id}`} className="font-medium text-brand-700 hover:underline">{t('mk.home.track')}</Link></p>
              {billing.invoices.length === 0 ? <p className="mt-3 text-sm text-slate-600">{t('mk.aiec.noInvoices')}</p> : (
                <ul className="mt-3 space-y-3">{billing.invoices.map((inv) => {
                  const pays = billing.payments.filter((p) => p.invoice_id === inv.id);
                  return (
                    <li key={inv.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span><span className="font-medium text-slate-900">{inv.milestone_name}</span><span className="block text-xs text-slate-600">{inv.invoice_number} · {t('mk.aiec.due', { date: formatDate(inv.due_date, locale) })}</span></span>
                        <span className="text-right"><span className="block font-semibold tabular-nums">{formatINR(inv.total_amount, locale)}</span>
                          <StatusBadge value={inv.status} label={t(`e.customerInvoiceStatus.${inv.status}`)} /></span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{t('mk.aiec.taxSplit', { taxable: formatINR(inv.taxable_amount, locale), gst: formatINR(inv.gst_amount, locale) })}</p>
                      {pays.length > 0 && <ul className="mt-2 space-y-1 text-xs">{pays.map((p) => (
                        <li key={p.id} className="flex flex-wrap justify-between gap-2"><span>{formatDate(p.paid_on, locale)} · {t(`e.customerPaymentMode.${p.payment_mode}`)} · {p.reference}</span>
                          <span className="tabular-nums">{formatINR(p.amount, locale)} <StatusBadge value={p.status} label={t(`e.customerPaymentStatus.${p.status}`)} /></span></li>
                      ))}</ul>}
                      {['ISSUED', 'PARTLY_PAID'].includes(inv.status) && (
                        <details className="mt-2"><summary className="cursor-pointer text-xs font-medium text-brand-700">{t('mk.aiec.iPaid')}</summary>
                          <ActionForm action={recordPaymentAction} className="mt-2 grid gap-2 sm:grid-cols-2"><input type="hidden" name="invoiceId" value={inv.id} />
                            <Field name="amount" label={t('f.amount')} inputMode="decimal" required />
                            <SelectField name="paymentMode" label={t('mk.aiec.mode')} options={modes} />
                            <Field name="reference" label={t('mk.aiec.referenceCustomer')} required />
                            <Field name="paidOn" type="date" label={t('mk.aiec.paidOn')} defaultValue={isoDateIST()} required />
                            <div className="sm:col-span-2"><SubmitButton size="sm">{t('mk.aiec.reportPayment')}</SubmitButton>
                              <p className="mt-1 text-xs text-slate-600">{t('mk.aiec.reportHint')}</p></div>
                          </ActionForm></details>
                      )}
                    </li>
                  );
                })}</ul>
              )}
            </Section>
          )}
          <Section title={t('mk.proj.configurations')} description={t('mk.proj.configurationsHint')}>
            {configurations.length === 0 ? (
              <EmptyState title={t('mk.proj.noConfigs')} action={spec ? <LinkButton href={`/customer/shop/projects/${id}/packages`}>{t('mk.proj.browse')}</LinkButton> : undefined} />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">{configurations.map((c) => (
                <li key={c.id}><Link href={`/customer/shop/cart/${c.id}`} className="block"><Card className="h-full p-4 hover:shadow-md">
                  <p className="font-semibold text-slate-900">{c.name}</p>
                  <p className="text-sm text-slate-600">{localized(c, 'package_title', locale)}</p>
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
