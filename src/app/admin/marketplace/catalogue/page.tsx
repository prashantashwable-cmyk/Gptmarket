import { priceReviewAction, productReviewAction, supplierStatusAction } from '@/app/actions/market';
import { FileLink, enumOptions } from '@/components/common';
import { SupplierScoreBadge } from '@/components/market/supplier-score';
import { Alert, Badge, EmptyState, PageHeader, Section, StatusBadge, Table, Td, Th } from '@/components/ui';
import { ActionForm, Field, SelectField, SubmitButton } from '@/components/ui/form';
import { SUPPLIER_STATUS } from '@/lib/enums';
import { formatDate, formatINR } from '@/lib/format';
import { load, pageCtx } from '@/server/page';
import { getCatalogueReview } from '@/server/services/catalogue';

function specText(specs: Record<string, unknown>): string {
  return Object.entries(specs ?? {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : String(v)}`).join(' · ');
}

export default async function CatalogueReview() {
  const { ctx, t, locale } = await pageCtx('admin');
  const { suppliers, products, prices } = await load(() => getCatalogueReview(ctx));
  const canApprove = ctx.permissions.has('catalogue.approve');
  const pending = products.filter((p) => p.approval_status === 'SUBMITTED');
  const others = products.filter((p) => p.approval_status !== 'SUBMITTED');
  return (
    <>
      <PageHeader title={t('mk.adm.catalogue')} subtitle={t('mk.rev.subtitle')} back={{ href: '/admin/marketplace', label: t('nav.marketplace') }} />
      <Alert tone="blue" className="mb-4">{t('mk.rev.separation')}</Alert>
      <Section title={t('mk.rev.prices', { count: prices.length })} description={t('mk.rev.pricesHint')}>
        {prices.length === 0 ? <EmptyState title={t('common.noData')} /> : (
          <Table>
            <thead><tr><Th>{t('mk.rev.product')}</Th><Th>{t('mk.rev.newPrice')}</Th><Th>{t('mk.rev.previous')}</Th><Th>{t('mk.rev.validFrom')}</Th><Th /></tr></thead>
            <tbody>{prices.map((p) => (
              <tr key={p.id}>
                <Td>{p.product_name}<span className="block text-xs text-slate-500">{p.brand} {p.model} · {p.supplier}</span></Td>
                <Td className="tabular-nums">{formatINR(p.unit_price)}{p.needs_review_reason && <Badge tone="red" className="ml-2">{t('mk.rev.jump', { percent: p.change_percent })}</Badge>}</Td>
                <Td className="tabular-nums">{formatINR(p.previous_price)}{p.change_percent !== null && !p.needs_review_reason && <span className="block text-xs text-slate-500">{Number(p.change_percent) > 0 ? '+' : ''}{p.change_percent}%</span>}</Td>
                <Td>{formatDate(p.valid_from, locale)}</Td>
                <Td>{canApprove && (
                  <ActionForm action={priceReviewAction} hideSuccess className="flex flex-wrap items-end gap-1.5"><input type="hidden" name="id" value={p.id} />
                    <Field name="note" aria-label={t('mk.rev.note')} placeholder={p.needs_review_reason ? t('mk.rev.noteRequired') : t('mk.rev.note')} />
                    <SubmitButton name="decision" value="APPROVED" size="sm" variant="success">{t('a.approve')}</SubmitButton>
                    <SubmitButton name="decision" value="REJECTED" size="sm" variant="secondary">{t('a.reject')}</SubmitButton>
                  </ActionForm>)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Section>

      <Section title={t('mk.rev.productsPending', { count: pending.length })} className="mt-5">
        {pending.length === 0 ? <EmptyState title={t('common.noData')} /> : (
          <Table>
            <thead><tr><Th>{t('mk.rev.product')}</Th><Th>{t('mk.rev.category')}</Th><Th>{t('mk.rev.specs')}</Th><Th>{t('mk.rev.docs')}</Th><Th /></tr></thead>
            <tbody>{pending.map((p) => (
              <tr key={p.id}>
                <Td>{p.name}<span className="block text-xs text-slate-500">{p.brand} {p.model} · {p.supplier}</span></Td>
                <Td>{t(`e.componentCategory.${p.category_code}`)}{['GUIDE_RAILS', 'ROPES', 'SAFETY_GEAR', 'GOVERNOR', 'BUFFERS', 'DOOR_LOCKS', 'ARD'].includes(p.category_code) && <Badge tone="red" className="ml-1">{t('mk.cart.safety')}</Badge>}</Td>
                <Td className="text-xs">{specText(p.specs) || '—'}</Td>
                <Td><FileLink id={p.document_file_id} label={t('mk.cart.datasheet')} /></Td>
                <Td>{canApprove && (
                  <ActionForm action={productReviewAction} hideSuccess className="flex flex-wrap items-end gap-1.5"><input type="hidden" name="id" value={p.id} />
                    <Field name="note" aria-label={t('mk.rev.note')} placeholder={t('mk.rev.note')} />
                    <SubmitButton name="decision" value="APPROVED" size="sm" variant="success">{t('a.approve')}</SubmitButton>
                    <SubmitButton name="decision" value="REJECTED" size="sm" variant="secondary">{t('a.reject')}</SubmitButton>
                  </ActionForm>)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Section>

      <Section title={t('mk.rev.suppliers')} description={t('mk.rev.suppliersHint')} className="mt-5">
        {suppliers.length === 0 ? <EmptyState title={t('common.noData')} /> : (
          <Table>
            <thead><tr><Th>{t('mk.rev.supplier')}</Th><Th>{t('mk.rev.kyc')}</Th><Th>{t('mk.rev.marketStatus')}</Th><Th>{t('mk.rev.approvedProducts')}</Th><Th>{t('mk.po.score')}</Th><Th /></tr></thead>
            <tbody>{suppliers.map((s) => (
              <tr key={s.id}>
                <Td>{s.legal_name}<span className="block text-xs text-slate-500">{t(`e.companyCategory.${s.category}`)}{s.gstin ? ` · GSTIN ${s.gstin}` : ''}</span></Td>
                <Td><StatusBadge value={s.status} label={t(`e.partnerStatus.${s.status}`)} /></Td>
                <Td><StatusBadge value={s.marketplace_status} label={t(`e.supplierStatus.${s.marketplace_status}`)} />{s.marketplace_status_reason && <span className="block text-xs text-slate-500">{s.marketplace_status_reason}</span>}</Td>
                <Td>{s.approved_products}</Td>
                <Td><SupplierScoreBadge t={t} score={s.score} detailed /></Td>
                <Td>{canApprove && (
                  <ActionForm action={supplierStatusAction} hideSuccess resetOnSuccess={false} className="flex flex-wrap items-end gap-1.5"><input type="hidden" name="companyId" value={s.id} />
                    <SelectField name="status" aria-label={t('mk.rev.marketStatus')} defaultValue={s.marketplace_status} options={enumOptions(t, 'supplierStatus', SUPPLIER_STATUS)} />
                    <Field name="reason" aria-label={t('mk.rev.reason')} placeholder={t('mk.rev.reason')} />
                    <SubmitButton size="sm" variant="secondary">{t('common.save')}</SubmitButton>
                  </ActionForm>)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Section>

      <Section title={t('mk.rev.allProducts', { count: others.length })} className="mt-5">
        {others.length === 0 ? <EmptyState title={t('common.noData')} /> : (
          <Table>
            <thead><tr><Th>{t('mk.rev.product')}</Th><Th>{t('mk.rev.category')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
            <tbody>{others.map((p) => (
              <tr key={p.id}>
                <Td>{p.name}<span className="block text-xs text-slate-500">{p.brand} {p.model} · {p.supplier}{p.is_demo ? ' · DEMO' : ''}</span></Td>
                <Td>{t(`e.componentCategory.${p.category_code}`)}</Td>
                <Td><StatusBadge value={p.approval_status} label={t(`e.productStatus.${p.approval_status}`)} /></Td>
                <Td>{canApprove && p.approval_status === 'APPROVED' && (
                  <ActionForm action={productReviewAction} hideSuccess className="flex flex-wrap items-end gap-1.5"><input type="hidden" name="id" value={p.id} />
                    <Field name="note" aria-label={t('mk.rev.reason')} placeholder={t('mk.rev.reason')} />
                    <SubmitButton name="decision" value="SUSPENDED" size="sm" variant="secondary">{t('mk.rev.suspend')}</SubmitButton>
                  </ActionForm>)}
                  {canApprove && p.approval_status === 'SUSPENDED' && (
                    <ActionForm action={productReviewAction} hideSuccess><input type="hidden" name="id" value={p.id} />
                      <SubmitButton name="decision" value="APPROVED" size="sm" variant="secondary">{t('mk.rev.reinstate')}</SubmitButton></ActionForm>)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
