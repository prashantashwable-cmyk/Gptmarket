import { saveSupplierProductAction, stockAction, submitPriceAction, submitProductAction, withdrawProductAction } from '@/app/actions/market';
import { Split } from '@/components/common';
import { SupplierProductForm } from '@/components/market/product-form';
import { Alert, EmptyState, PageHeader, Section, StatusBadge, Table, Td, Th } from '@/components/ui';
import { ActionForm, Field, SubmitButton } from '@/components/ui/form';
import { AppError } from '@/lib/errors';
import { formatDate, formatINR, isoDateIST } from '@/lib/format';
import { load, pageCtx } from '@/server/page';
import { getSupplierCatalogue } from '@/server/services/catalogue';

export default async function SupplierMarketplace() {
  const { ctx, t, locale } = await pageCtx('partner');
  let data: Awaited<ReturnType<typeof getSupplierCatalogue>> | null = null;
  try { data = await load(() => getSupplierCatalogue(ctx)); } catch (error) { if (!(error instanceof AppError && error.code === 'NOT_A_SUPPLIER')) throw error; }
  if (!data) return (<><PageHeader title={t('nav.supplierCatalogue')} /><Alert tone="amber">{t('err.NOT_A_SUPPLIER')}</Alert></>);
  const { company, products, prices } = data;
  const approvedSupplier = ['APPROVED', 'PREFERRED'].includes(company.marketplace_status);
  return (
    <>
      <PageHeader title={t('nav.supplierCatalogue')} subtitle={t('mk.sup.subtitle')}
        actions={<StatusBadge value={company.marketplace_status} label={t(`e.supplierStatus.${company.marketplace_status}`)} />} />
      {!approvedSupplier && <Alert tone="amber" className="mb-4">{t('mk.sup.notApproved')}</Alert>}
      <Split
        main={<>
          <Section title={t('mk.sup.products', { count: products.length })} description={t('mk.sup.productsHint')}>
            {products.length === 0 ? <EmptyState title={t('common.noData')} /> : (
              <ul className="space-y-3">{products.map((p) => (
                <li key={p.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span><span className="font-medium text-slate-900">{p.name}</span><span className="block text-xs text-slate-500">{t(`e.componentCategory.${p.category_code}`)} · {p.brand} {p.model} · {t(`e.priceUnit.${p.price_unit}`)}</span></span>
                    <StatusBadge value={p.approval_status} label={t(`e.productStatus.${p.approval_status}`)} />
                  </div>
                  {p.review_note && <p className="mt-1 text-xs text-slate-600">{t('mk.sup.reviewNote')}: {p.review_note}</p>}
                  <p className="mt-1 text-sm">{t('mk.sup.currentPrice')}: <span className="font-semibold tabular-nums">{formatINR(p.current_price)}</span></p>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <ActionForm action={submitPriceAction} className="flex flex-wrap items-end gap-1.5"><input type="hidden" name="productId" value={p.id} />
                      <Field name="unitPrice" label={t('mk.sup.newPrice')} inputMode="decimal" required className="w-28" />
                      <Field name="validFrom" type="date" label={t('mk.rev.validFrom')} defaultValue={isoDateIST()} required />
                      <SubmitButton size="sm" variant="secondary">{t('mk.sup.submitPrice')}</SubmitButton>
                    </ActionForm>
                    <ActionForm action={stockAction} hideSuccess resetOnSuccess={false} className="flex flex-wrap items-end gap-1.5"><input type="hidden" name="id" value={p.id} />
                      <Field name="stockQty" type="number" label={t('mk.sup.stock')} defaultValue={p.stock_qty} className="w-20" />
                      <Field name="deliveryDays" type="number" label={t('mk.sup.delivery')} defaultValue={p.delivery_days} className="w-20" />
                      <SubmitButton size="sm" variant="secondary">{t('common.save')}</SubmitButton>
                    </ActionForm>
                    {['DRAFT', 'REJECTED'].includes(p.approval_status) && (
                      <ActionForm action={submitProductAction} hideSuccess><input type="hidden" name="id" value={p.id} /><SubmitButton size="sm">{t('mk.sup.submit')}</SubmitButton></ActionForm>
                    )}
                    <ActionForm action={withdrawProductAction} hideSuccess><input type="hidden" name="id" value={p.id} />
                      <SubmitButton size="sm" variant="ghost" confirm={t('mk.sup.withdrawConfirm')}>{t('mk.sup.withdraw')}</SubmitButton></ActionForm>
                  </div>
                </li>
              ))}</ul>
            )}
          </Section>
          <Section title={t('mk.sup.priceHistory')} className="mt-5">
            {prices.length === 0 ? <EmptyState title={t('common.noData')} /> : (
              <Table>
                <thead><tr><Th>{t('mk.rev.product')}</Th><Th>{t('mk.sup.newPrice')}</Th><Th>{t('mk.rev.validFrom')}</Th><Th>{t('common.status')}</Th></tr></thead>
                <tbody>{prices.map((pr) => (
                  <tr key={pr.id}><Td>{pr.product_name}</Td><Td className="tabular-nums">{formatINR(pr.unit_price)}{pr.change_percent !== null && <span className="block text-xs text-slate-500">{Number(pr.change_percent) > 0 ? '+' : ''}{pr.change_percent}%</span>}</Td>
                    <Td>{formatDate(pr.valid_from, locale)}{pr.valid_to ? ` – ${formatDate(pr.valid_to, locale)}` : ''}</Td>
                    <Td><StatusBadge value={pr.status} label={t(`e.priceStatus.${pr.status}`)} />{pr.review_note && <span className="block text-xs text-slate-500">{pr.review_note}</span>}</Td></tr>
                ))}</tbody>
              </Table>
            )}
          </Section>
        </>}
        side={<Section title={t('mk.sup.add')} description={t('mk.sup.addHint')}><SupplierProductForm action={saveSupplierProductAction} /></Section>}
      />
    </>
  );
}
