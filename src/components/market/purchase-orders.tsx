import type { ReactNode } from 'react';
import { generatePosAction, staffPoAction, supplierPaymentAction, supplierPoAction } from '@/app/actions/market';
import { EmptyState, Section, StatusBadge } from '@/components/ui';
import { ActionForm, Field, SubmitButton } from '@/components/ui/form';
import type { TFunction } from '@/i18n';
import type { Locale } from '@/lib/enums';
import { formatDate, formatINR, isoDateIST } from '@/lib/format';
import type { Ctx } from '@/server/ctx';
import type { Rec } from '@/server/db';

function PoCard({ t, locale, po, children }: { t: TFunction; locale: Locale; po: Rec; children?: ReactNode }) {
  return (
    <li className="rounded-lg border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span><span className="font-semibold text-slate-900">{po.po_number}</span>
          <span className="block text-xs text-slate-600">{po.supplier ?? `${po.project_label} · ${po.order_number}`}</span></span>
        <span className="text-right"><span className="block font-semibold tabular-nums">{formatINR(po.total_cost, locale)}</span>
          <StatusBadge value={po.status} label={t(`e.supplierPoStatus.${po.status}`)} /></span>
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-slate-700">{(po.lines as Rec[]).map((l) => (
        <li key={l.id} className="flex justify-between gap-2"><span>{l.quantity} × {l.description}</span><span className="tabular-nums">{formatINR(l.line_total, locale)}</span></li>
      ))}</ul>
      <p className="mt-2 text-xs text-slate-600">
        {po.expected_delivery && <>{t('mk.po.expected', { date: formatDate(po.expected_delivery, locale) })} · </>}
        {po.dispatch_reference && <>{t('mk.po.dispatchRef', { ref: po.dispatch_reference })} · </>}
        {t('mk.po.paidOf', { paid: formatINR(po.paid, locale), outstanding: formatINR(po.outstanding, locale) })}
      </p>
      {po.cancel_reason && <p className="mt-1 text-xs text-red-700">{po.cancel_reason}</p>}
      {children}
    </li>
  );
}

/** AIEC staff view of the supplier purchase orders of one AIEC Contract order. */
export function StaffPurchaseOrders({ ctx, t, locale, orderId, orderStatus, pos }: { ctx: Ctx; t: TFunction; locale: Locale; orderId: string; orderStatus: string; pos: Rec[] }) {
  const canManage = ctx.permissions.has('order.manage') || ctx.permissions.has('project.manage');
  const canPay = ctx.permissions.has('payout.approve');
  return (
    <Section title={t('mk.po.title')} description={t('mk.po.hint')} className="mt-5">
      {pos.length === 0 ? (
        ['CONFIRMED', 'COMPLETED'].includes(orderStatus) && ctx.permissions.has('order.manage') ? (
          <ActionForm action={generatePosAction}><input type="hidden" name="id" value={orderId} /><SubmitButton size="sm">{t('mk.po.generate')}</SubmitButton></ActionForm>
        ) : <EmptyState title={t('mk.po.afterConfirm')} />
      ) : (
        <ul className="space-y-3">{pos.map((po) => (
          <PoCard key={po.id} t={t} locale={locale} po={po}>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              {canManage && po.status === 'DISPATCHED' && (
                <ActionForm action={staffPoAction} hideSuccess><input type="hidden" name="id" value={po.id} /><input type="hidden" name="action" value="DELIVERED" />
                  <SubmitButton size="sm" variant="success">{t('mk.po.markDelivered')}</SubmitButton></ActionForm>)}
              {canManage && ['ISSUED', 'ACKNOWLEDGED'].includes(po.status) && (
                <ActionForm action={staffPoAction} hideSuccess className="flex items-end gap-1.5"><input type="hidden" name="id" value={po.id} /><input type="hidden" name="action" value="CANCEL" />
                  <Field name="reason" aria-label={t('mk.rev.reason')} placeholder={t('mk.rev.reason')} className="w-32" />
                  <SubmitButton size="sm" variant="ghost">{t('mk.po.cancel')}</SubmitButton></ActionForm>)}
              {canPay && po.status !== 'CANCELLED' && Number(po.outstanding) > 0 && (
                <ActionForm action={supplierPaymentAction} className="flex flex-wrap items-end gap-1.5"><input type="hidden" name="poId" value={po.id} />
                  <Field name="amount" label={t('f.amount')} inputMode="decimal" required className="w-28" />
                  <Field name="reference" label={t('mk.aiec.reference')} required className="w-32" />
                  <Field name="paidOn" type="date" label={t('mk.aiec.paidOn')} defaultValue={isoDateIST()} required />
                  <SubmitButton size="sm" variant="secondary">{t('mk.po.recordPayment')}</SubmitButton></ActionForm>)}
            </div>
          </PoCard>
        ))}</ul>
      )}
    </Section>
  );
}

/** Supplier view: its purchase orders with acknowledge / dispatch actions. */
export function SupplierPurchaseOrders({ t, locale, pos }: { t: TFunction; locale: Locale; pos: Rec[] }) {
  if (pos.length === 0) return <EmptyState title={t('mk.po.none')} hint={t('mk.po.noneHint')} />;
  return (
    <ul className="space-y-3">{pos.map((po) => (
      <PoCard key={po.id} t={t} locale={locale} po={po}>
        <p className="mt-1 text-xs text-slate-600">{t('mk.po.deliverTo', { address: po.delivery_address })}</p>
        {po.status === 'ISSUED' && (
          <ActionForm action={supplierPoAction} className="mt-2 flex flex-wrap items-end gap-1.5"><input type="hidden" name="id" value={po.id} /><input type="hidden" name="action" value="ACKNOWLEDGE" />
            <Field name="expectedDelivery" type="date" label={t('mk.po.expectedLabel')} required />
            <SubmitButton size="sm">{t('mk.po.acknowledge')}</SubmitButton></ActionForm>)}
        {['ISSUED', 'ACKNOWLEDGED'].includes(po.status) && (
          <ActionForm action={supplierPoAction} className="mt-2 flex flex-wrap items-end gap-1.5"><input type="hidden" name="id" value={po.id} /><input type="hidden" name="action" value="DISPATCH" />
            <Field name="reference" label={t('mk.po.dispatchLabel')} required />
            <SubmitButton size="sm" variant="secondary">{t('mk.po.dispatch')}</SubmitButton></ActionForm>)}
      </PoCard>
    ))}</ul>
  );
}
