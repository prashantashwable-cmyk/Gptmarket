import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BadgeCheck, Lock, PackageOpen, Truck } from 'lucide-react';
import { requestQuotationAction, saveConfigurationAction, setCartOptionAction } from '@/app/actions/market';
import { FileLink } from '@/components/common';
import { CompatPanel, PriceSummary } from '@/components/market/views';
import { Alert, Badge, PageHeader, Section, buttonClass } from '@/components/ui';
import { ActionForm, Field, SubmitButton } from '@/components/ui/form';
import type { TFunction } from '@/i18n';
import { cn, formatINR } from '@/lib/format';
import { isUuid, load, pageCtx } from '@/server/page';
import type { CustomerView } from '@/server/services/market-engine';
import { getCart } from '@/server/services/shop';

type Slot = CustomerView['slots'][number];
const KIND_TONE = { STANDARD: 'gray', UPGRADE: 'amber', ALTERNATIVE: 'blue' } as const;

function OptionCard({ t, slot, option, configId, locked }: { t: TFunction; slot: Slot; option: Slot['options'][number]; configId: string; locked: boolean }) {
  const selected = slot.selectedProductId === option.productId;
  const charge = slot.isMandatory ? option.upgradeCharge : option.customerPrice;
  return (
    <li className={cn('flex flex-col gap-2 rounded-lg border p-3', selected ? 'border-brand-600 ring-2 ring-brand-200' : 'border-slate-200', !option.eligible && 'opacity-60')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{option.name}</p>
          <p className="text-xs text-slate-600">{option.brand} · {option.model}</p>
        </div>
        <Badge tone={KIND_TONE[option.kind]}>{t(`e.optionKind.${option.kind}`)}</Badge>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1"><BadgeCheck className="size-3.5 text-emerald-600" aria-hidden />{option.supplierName}</span>
        <span>{t('mk.cart.warranty', { months: option.warrantyMonths })}</span>
        <span className="inline-flex items-center gap-1"><Truck className="size-3.5" aria-hidden />{t('mk.cart.delivery', { days: option.deliveryDays })}</span>
        <span className={option.inStock ? 'text-emerald-700' : 'text-amber-700'}>{option.inStock ? t('mk.cart.inStock') : t('mk.cart.onOrder')}</span>
        {option.documentFileId && <FileLink id={option.documentFileId} label={t('mk.cart.datasheet')} />}
      </p>
      {!option.eligible && <p className="text-xs font-medium text-red-700">{t('mk.cart.unavailable')}</p>}
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums text-slate-900">
          {charge === null ? '—' : slot.isMandatory ? (Number(charge) > 0 ? `+ ${formatINR(charge)}` : t('mk.cart.included')) : `+ ${formatINR(charge)}`}
        </span>
        {selected ? <Badge tone="green">{t('mk.cart.selected')}</Badge> : !locked && option.eligible && (
          <ActionForm action={setCartOptionAction} hideSuccess resetOnSuccess={false}>
            <input type="hidden" name="configId" value={configId} /><input type="hidden" name="slotId" value={slot.slotId} /><input type="hidden" name="productId" value={option.productId} />
            <SubmitButton size="sm" variant="secondary">{slot.isMandatory ? t('mk.cart.choose') : t('mk.cart.add')}</SubmitButton>
          </ActionForm>
        )}
      </div>
    </li>
  );
}

export default async function CartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { ctx, t } = await pageCtx('customer');
  const { config, view } = await load(() => getCart(ctx, id));
  const accepted = config.quotation_status === 'ACCEPTED';
  const locked = accepted || config.status === 'ARCHIVED';
  const editable = view.slots.filter((s) => s.isMandatory && s.customerEditable);
  const addOns = view.slots.filter((s) => !s.isMandatory);
  const fixed = view.slots.filter((s) => s.isMandatory && !s.customerEditable && !s.isSafetyCritical);
  const safety = view.slots.filter((s) => s.isSafetyCritical);
  const selectedName = (s: Slot) => s.options.find((o) => o.productId === s.selectedProductId);
  const red = view.compat?.status === 'RED';
  return (
    <>
      <PageHeader title={config.name} subtitle={`${view.packageVersion.title} · ${config.project_name} · ${config.config_number}`}
        back={{ href: `/customer/shop/projects/${config.lead_id}`, label: t('mk.proj.back') }} />
      {accepted && <Alert tone="green" className="mb-4">{t('mk.cart.acceptedLocked')}</Alert>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title={t('mk.cart.customise')} description={t('mk.cart.customiseHint')}>
            <div className="space-y-5">{editable.map((s) => (
              <div key={s.slotId}>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">{t(`e.componentCategory.${s.category}`)}</h3>
                <ul className="grid gap-2 sm:grid-cols-2">{s.options.map((o) => <OptionCard key={o.productId} t={t} slot={s} option={o} configId={id} locked={locked} />)}</ul>
              </div>
            ))}</div>
          </Section>
          {addOns.length > 0 && (
            <Section title={t('mk.cart.addOns')} description={t('mk.cart.addOnsHint')}>
              {addOns.map((s) => (
                <div key={s.slotId} className="space-y-2">
                  <ul className="grid gap-2 sm:grid-cols-2">{s.options.map((o) => <OptionCard key={o.productId} t={t} slot={s} option={o} configId={id} locked={locked} />)}</ul>
                  {s.selectedProductId && !locked && (
                    <ActionForm action={setCartOptionAction} hideSuccess resetOnSuccess={false}>
                      <input type="hidden" name="configId" value={id} /><input type="hidden" name="slotId" value={s.slotId} /><input type="hidden" name="productId" value="NONE" />
                      <SubmitButton size="sm" variant="ghost">{t('mk.cart.removeAddOn')}</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              ))}
            </Section>
          )}
          <Section title={t('mk.cart.fixed')} description={t('mk.cart.fixedHint')}>
            <ul className="divide-y divide-slate-100 text-sm">{[...fixed, ...safety].map((s) => {
              const o = selectedName(s);
              return (
                <li key={s.slotId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    {s.isSafetyCritical ? <Lock className="size-4 text-brand-700" aria-label={t('mk.cart.safety')} /> : <PackageOpen className="size-4 text-slate-400" aria-hidden />}
                    <span><span className="font-medium text-slate-900">{t(`e.componentCategory.${s.category}`)}</span>
                      <span className="block text-xs text-slate-600">{o ? `${o.name} · ${o.brand} ${o.model} · ${o.supplierName}` : '—'}</span></span>
                  </span>
                  <span className="text-xs text-slate-500">{s.line ? t('mk.cart.qty', { qty: s.line.quantity }) : ''}{s.isSafetyCritical ? ` · ${t('mk.cart.safety')}` : ''}</span>
                </li>
              );
            })}</ul>
          </Section>
        </div>

        <aside id="checkout" className="scroll-mt-4 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Section title={t('mk.cart.summary')}>
            {view.totals ? <PriceSummary t={t} totals={view.totals} basis="LIVE" /> : <Alert tone="amber">{t(`mk.pricingStatus.${view.pricingStatus}`)}</Alert>}
          </Section>
          <CompatPanel t={t} compat={view.compat} />
          {!locked && (
            <Section>
              <ActionForm action={requestQuotationAction} hideSuccess>
                <input type="hidden" name="configId" value={id} /><input type="hidden" name="requestId" value={randomUUID()} />
                <SubmitButton size="lg" className="w-full" disabled={red || !view.totals}>{t('mk.cart.requestQuote')}</SubmitButton>
              </ActionForm>
              <p className="mt-2 text-xs text-slate-600">{red ? t('mk.cart.redBlocked') : t('mk.cart.requestHint')}</p>
              {config.quotation_id && <Link href={`/customer/shop/quotations/${config.quotation_id}`} className="mt-3 block text-sm font-medium text-brand-700 hover:underline">{t('mk.cart.viewQuote')}</Link>}
            </Section>
          )}
          {!locked && (
            <Section title={t('mk.cart.saveTitle')}>
              <ActionForm action={saveConfigurationAction} resetOnSuccess={false} className="space-y-2">
                <input type="hidden" name="configId" value={id} /><input type="hidden" name="leadId" value={config.lead_id} />
                <Field name="name" label={t('mk.cart.name')} defaultValue={config.name} required />
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="action" value="SAVE" size="sm">{t('mk.cart.save')}</SubmitButton>
                  <SubmitButton name="action" value="ARCHIVE" size="sm" variant="ghost" confirm={t('mk.cart.archiveConfirm')}>{t('mk.cart.archive')}</SubmitButton>
                </div>
              </ActionForm>
            </Section>
          )}
          {accepted && config.quotation_id && <Link href={`/customer/shop/quotations/${config.quotation_id}`} className="block text-sm font-medium text-brand-700 hover:underline">{t('mk.cart.viewQuote')}</Link>}
        </aside>
      </div>
      {/* Mobile: the live total stays visible while customising. */}
      <div className="h-20 lg:hidden" aria-hidden />
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-slate-200 bg-surface px-4 py-3 shadow-lg lg:hidden">
        <span className="min-w-0"><span className="block text-xs text-slate-600">{t('mk.price.totalEstimated')}</span>
          <span className="block text-lg font-bold tabular-nums text-slate-900">{view.totals ? formatINR(view.totals.totalPayable) : t(`mk.pricingStatus.${view.pricingStatus}`)}</span></span>
        <a href="#checkout" className={buttonClass(red ? 'secondary' : 'primary', 'md')}>{locked ? t('mk.cart.summary') : t('mk.cart.requestQuote')}</a>
      </div>
    </>
  );
}
