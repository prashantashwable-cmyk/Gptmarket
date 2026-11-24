import { cancelInvoiceAction, issueInvoiceAction, payoutAction, recordPaymentAction, refundAction, verifyPaymentAction } from '@/app/actions/market';
import { Alert, Badge, EmptyState, Section, Stat, StatusBadge, Table, Td, Th } from '@/components/ui';
import { ActionForm, Field, SelectField, SubmitButton } from '@/components/ui/form';
import type { TFunction } from '@/i18n';
import { CUSTOMER_PAYMENT_MODE, type Locale } from '@/lib/enums';
import { formatDate, formatINR, isoDateIST } from '@/lib/format';
import type { Ctx } from '@/server/ctx';
import type { getAiecFinance } from '@/server/services/aiec-contract';

type Finance = NonNullable<Awaited<ReturnType<typeof getAiecFinance>>>;

function actOnPayoutForm({ t, payout: po }: { t: TFunction; payout: Finance['payouts'][number] }) {
  if (po.status === 'PAID') return null;
  return (
    <div className="flex flex-wrap items-end gap-1.5">
      {['PENDING', 'HELD'].includes(po.status) && (
        <ActionForm action={payoutAction} hideSuccess><input type="hidden" name="id" value={po.id} /><input type="hidden" name="action" value="APPROVE" />
          <SubmitButton size="sm" variant="success">{t('a.approve')}</SubmitButton></ActionForm>)}
      {po.status === 'APPROVED' && (
        <ActionForm action={payoutAction} hideSuccess className="flex flex-wrap items-end gap-1.5"><input type="hidden" name="id" value={po.id} /><input type="hidden" name="action" value="PAID" />
          <Field name="reference" aria-label={t('mk.aiec.reference')} placeholder={t('mk.aiec.reference')} className="w-28" />
          <Field name="paidOn" type="date" aria-label={t('mk.aiec.paidOn')} defaultValue={isoDateIST()} />
          <SubmitButton size="sm">{t('mk.aiec.markPaid')}</SubmitButton></ActionForm>)}
      {['PENDING', 'APPROVED'].includes(po.status) && (
        <ActionForm action={payoutAction} hideSuccess className="flex flex-wrap items-end gap-1.5"><input type="hidden" name="id" value={po.id} /><input type="hidden" name="action" value="HOLD" />
          <Field name="reason" aria-label={t('mk.rev.reason')} placeholder={t('mk.rev.reason')} className="w-28" />
          <SubmitButton size="sm" variant="ghost">{t('mk.aiec.hold')}</SubmitButton></ActionForm>)}
    </div>
  );
}

/** AIEC Contract money view: staff see invoices, payments, refunds and payouts; the partner sees its payouts only. */
export function AiecFinanceView({ ctx, t, locale, data }: { ctx: Ctx; t: TFunction; locale: Locale; data: Finance }) {
  const { milestones, invoices, payments, refunds, payouts, summary, staff } = data;
  const canMoney = staff && ctx.permissions.has('payment.reconcile');
  const canPayout = staff && ctx.permissions.has('payout.approve');
  const modes = CUSTOMER_PAYMENT_MODE.filter((m) => m !== 'GATEWAY').map((m) => ({ value: m, label: t(`e.customerPaymentMode.${m}`) }));
  const invoiceFor = (milestoneId: string) => invoices.find((i) => i.milestone_id === milestoneId && i.status !== 'CANCELLED');
  return (
    <div className="mt-5 space-y-5">
      {staff && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t('mk.aiec.invoiced')} value={formatINR(summary.invoiced, locale)} />
          <Stat label={t('mk.aiec.received')} value={formatINR(summary.received, locale)} hint={Number(summary.refunded) > 0 ? t('mk.aiec.refundedHint', { amount: formatINR(summary.refunded, locale) }) : undefined} />
          <Stat label={t('mk.aiec.payoutApproved')} value={formatINR(summary.payoutApproved, locale)} />
          <Stat label={t('mk.aiec.payoutPaid')} value={formatINR(summary.payoutPaid, locale)} />
        </div>
      )}

      {staff && (
        <Section title={t('mk.aiec.invoices')} description={t('mk.aiec.invoicesHint')}>
          {milestones.length === 0 ? <EmptyState title={t('mk.aiec.noProject')} /> : (
            <Table>
              <thead><tr><Th>{t('f.milestone')}</Th><Th>{t('f.amount')}</Th><Th>{t('mk.aiec.invoice')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
              <tbody>{milestones.map((m) => {
                const inv = invoiceFor(m.id);
                return (
                  <tr key={m.id}>
                    <Td>{m.seq}. {m.name}<span className="block text-xs text-slate-500">{t(`e.milestoneStatus.${m.status}`)}</span></Td>
                    <Td className="tabular-nums">{formatINR(m.amount_due, locale)}</Td>
                    <Td>{inv ? <>{inv.invoice_number}<span className="block text-xs text-slate-500">{t('mk.aiec.taxSplit', { taxable: formatINR(inv.taxable_amount, locale), gst: formatINR(inv.gst_amount, locale) })} · {t('mk.aiec.due', { date: formatDate(inv.due_date, locale) })}</span></> : '—'}</Td>
                    <Td>{inv ? <StatusBadge value={inv.status} label={t(`e.customerInvoiceStatus.${inv.status}`)} /> : '—'}</Td>
                    <Td>{canMoney && !inv && (
                      <ActionForm action={issueInvoiceAction} hideSuccess><input type="hidden" name="milestoneId" value={m.id} /><input type="hidden" name="dueDays" value="7" />
                        <SubmitButton size="sm" variant="secondary">{t('mk.aiec.issueInvoice')}</SubmitButton></ActionForm>)}
                      {canMoney && inv?.status === 'ISSUED' && (
                        <ActionForm action={cancelInvoiceAction} hideSuccess className="flex items-end gap-1.5"><input type="hidden" name="id" value={inv.id} />
                          <Field name="reason" aria-label={t('mk.rev.reason')} placeholder={t('mk.rev.reason')} className="w-28" />
                          <SubmitButton size="sm" variant="ghost">{t('mk.aiec.cancelInvoice')}</SubmitButton></ActionForm>)}</Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          )}
          {canMoney && invoices.some((i) => ['ISSUED', 'PARTLY_PAID'].includes(i.status)) && (
            <ActionForm action={recordPaymentAction} className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-6">
              <SelectField name="invoiceId" label={t('mk.aiec.invoice')} wrapperClassName="sm:col-span-2" required
                options={invoices.filter((i) => ['ISSUED', 'PARTLY_PAID'].includes(i.status)).map((i) => ({ value: i.id, label: `${i.invoice_number} · ${formatINR(i.total_amount, locale)}` }))} />
              <Field name="amount" label={t('f.amount')} inputMode="decimal" required />
              <SelectField name="paymentMode" label={t('mk.aiec.mode')} options={modes} />
              <Field name="reference" label={t('mk.aiec.reference')} required />
              <Field name="paidOn" type="date" label={t('mk.aiec.paidOn')} defaultValue={isoDateIST()} required />
              <div className="sm:col-span-6"><SubmitButton size="sm">{t('mk.aiec.recordPayment')}</SubmitButton>
                <span className="ml-2 text-xs text-slate-600">{t('mk.aiec.makerChecker')}</span></div>
            </ActionForm>
          )}
        </Section>
      )}

      {staff && (
        <Section title={t('mk.aiec.payments')} description={t('mk.aiec.paymentsHint')}>
          {payments.length === 0 ? <EmptyState title={t('common.noData')} /> : (
            <Table>
              <thead><tr><Th>{t('mk.aiec.paidOn')}</Th><Th>{t('f.amount')}</Th><Th>{t('mk.aiec.reference')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
              <tbody>{payments.map((p) => (
                <tr key={p.id}>
                  <Td>{formatDate(p.paid_on, locale)}<span className="block text-xs text-slate-500">{p.recorded_by_name ?? t('mk.aiec.gateway')}</span></Td>
                  <Td className="tabular-nums">{formatINR(p.amount, locale)}{Number(p.refunded_amount) > 0 && <span className="block text-xs text-red-700">{t('mk.aiec.refunded', { amount: formatINR(p.refunded_amount, locale) })}</span>}</Td>
                  <Td>{t(`e.customerPaymentMode.${p.payment_mode}`)}<span className="block text-xs text-slate-500">{p.reference}</span></Td>
                  <Td><StatusBadge value={p.status} label={t(`e.customerPaymentStatus.${p.status}`)} />{p.verification_basis && <Badge tone="gray" className="ml-1">{t(`mk.aiec.basis.${p.verification_basis}`)}</Badge>}
                    {p.review_note && <span className="block text-xs text-slate-500">{p.review_note}</span>}</Td>
                  <Td>{canMoney && p.status === 'PENDING_VERIFICATION' && (
                    <ActionForm action={verifyPaymentAction} hideSuccess className="flex flex-wrap items-end gap-1.5"><input type="hidden" name="id" value={p.id} />
                      <Field name="note" aria-label={t('mk.rev.note')} placeholder={t('mk.rev.note')} className="w-32" />
                      <SubmitButton name="decision" value="VERIFIED" size="sm" variant="success">{t('a.verify')}</SubmitButton>
                      <SubmitButton name="decision" value="REJECTED" size="sm" variant="secondary">{t('a.reject')}</SubmitButton>
                    </ActionForm>)}
                    {canMoney && p.status === 'VERIFIED' && Number(p.amount) > Number(p.refunded_amount) && (
                      <details><summary className="cursor-pointer text-xs text-brand-700">{t('mk.aiec.refund')}</summary>
                        <ActionForm action={refundAction} className="mt-1 space-y-1.5"><input type="hidden" name="paymentId" value={p.id} />
                          <Field name="amount" label={t('f.amount')} inputMode="decimal" required />
                          <Field name="reason" label={t('mk.rev.reason')} required />
                          <Field name="reference" label={t('mk.aiec.reference')} />
                          <SubmitButton size="sm" variant="secondary" confirm={t('mk.aiec.refundConfirm')}>{t('mk.aiec.refund')}</SubmitButton>
                        </ActionForm></details>)}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
          {refunds.length > 0 && <p className="mt-2 text-xs text-slate-600">{t('mk.aiec.refundCount', { count: refunds.length })}</p>}
        </Section>
      )}

      <Section title={t('mk.aiec.payouts')} description={t(staff ? 'mk.aiec.payoutsHint' : 'mk.aiec.payoutsHintPartner')}>
        {payouts.length === 0 ? <EmptyState title={t('mk.aiec.noProject')} /> : (
          <Table>
            <thead><tr><Th>{t('f.milestone')}</Th><Th>{t('f.amount')}</Th><Th>{t('common.status')}</Th>{canPayout && <Th />}</tr></thead>
            <tbody>{payouts.map((po) => (
              <tr key={po.id}>
                <Td>{po.seq}. {po.milestone_name}<span className="block text-xs text-slate-500">{t(`e.milestoneStatus.${po.milestone_status}`)}</span></Td>
                <Td className="tabular-nums">{formatINR(po.amount, locale)}</Td>
                <Td><StatusBadge value={po.status} label={t(`e.payoutStatus.${po.status}`)} />
                  {po.paid_reference && <span className="block text-xs text-slate-500">{po.paid_reference} · {formatDate(po.paid_on, locale)}</span>}
                  {po.hold_reason && <span className="block text-xs text-red-700">{po.hold_reason}</span>}</Td>
                {canPayout && <Td>{actOnPayoutForm({ t, payout: po })}</Td>}
              </tr>
            ))}</tbody>
          </Table>
        )}
        {staff && !canPayout && <Alert tone="gray" className="mt-3">{t('mk.aiec.payoutOwnerOnly')}</Alert>}
      </Section>
    </div>
  );
}
