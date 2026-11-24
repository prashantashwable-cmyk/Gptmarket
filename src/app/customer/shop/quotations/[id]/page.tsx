import { notFound } from 'next/navigation';
import { Download } from 'lucide-react';
import { respondQuotationAction } from '@/app/actions/market';
import { QuotationDocument } from '@/components/market/quotation-doc';
import { Alert, PageHeader, Section } from '@/components/ui';
import { ActionForm, CheckboxField, SubmitButton, TextareaField } from '@/components/ui/form';
import { buttonClass } from '@/components/ui';
import { EXECUTION_MODEL } from '@/lib/enums';
import { isoDateIST } from '@/lib/format';
import { isUuid, load, pageCtx } from '@/server/page';
import { getMarketQuotation } from '@/server/services/market-quotes';

export default async function CustomerQuotation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { ctx, t, locale } = await pageCtx('customer');
  const { quotation, current, approvals } = await load(() => getMarketQuotation(ctx, id));
  if (!current) notFound();
  const canAccept = quotation.status === 'ISSUED' && current.price_basis === 'FINAL' && current.valid_until >= isoDateIST();
  const open = ['ESTIMATE', 'PENDING_ENGINEERING', 'PENDING_OWNER_APPROVAL', 'ISSUED'].includes(quotation.status);
  return (
    <>
      <PageHeader title={t('mk.quote.title')} subtitle={`${quotation.project_name} · ${quotation.config_name}`} back={{ href: `/customer/shop/cart/${quotation.configuration_id}`, label: t('mk.quote.backToCart') }}
        actions={<a href={`/api/market/quotations/${id}/pdf`} className={buttonClass('secondary', 'sm')}><Download className="size-4" aria-hidden />{t('mk.quote.pdf')}</a>} />
      <Alert tone="blue" className="mb-4">{t(`mk.quote.next.${quotation.status}`)}</Alert>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2"><QuotationDocument t={t} locale={locale} quotation={quotation} version={current} approvals={approvals} /></div>
        <aside className="space-y-4">
          {canAccept && (
            <Section title={t('mk.quote.acceptTitle')}>
              <ActionForm action={respondQuotationAction} className="space-y-3">
                <input type="hidden" name="id" value={id} />
                <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium text-slate-800">{t('mk.quote.model')}</legend>
                  {EXECUTION_MODEL.map((m) => (
                    <label key={m} className="flex gap-2 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                      <input type="radio" name="executionModel" value={m} className="mt-1 accent-brand-600" required />
                      <span><span className="font-semibold">{t(`e.executionModel.${m}`)}</span><span className="block text-xs text-slate-600">{t(`mk.model.${m}`)}</span></span>
                    </label>
                  ))}</fieldset>
                <CheckboxField name="termsAccepted" required label={t('mk.quote.terms')} />
                <SubmitButton name="decision" value="ACCEPT" size="lg" className="w-full">{t('mk.quote.accept')}</SubmitButton>
              </ActionForm>
            </Section>
          )}
          {open && (
            <Section title={t('mk.quote.declineTitle')}>
              <ActionForm action={respondQuotationAction} className="space-y-2">
                <input type="hidden" name="id" value={id} />
                <TextareaField name="note" label={t('mk.quote.declineReason')} rows={2} />
                <SubmitButton name="decision" value="DECLINE" variant="secondary" size="sm" confirm={t('mk.quote.declineConfirm')}>{t('mk.quote.decline')}</SubmitButton>
              </ActionForm>
            </Section>
          )}
          {quotation.status === 'ACCEPTED' && <Alert tone="green">{t('mk.quote.acceptedInfo', { model: t(`e.executionModel.${quotation.execution_model}`) })}</Alert>}
        </aside>
      </div>
    </>
  );
}
