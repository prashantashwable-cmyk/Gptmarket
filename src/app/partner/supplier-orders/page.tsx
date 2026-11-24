import { SupplierPurchaseOrders } from '@/components/market/purchase-orders';
import { SupplierScoreBadge } from '@/components/market/supplier-score';
import { Alert, PageHeader, Section, Stat } from '@/components/ui';
import { AppError } from '@/lib/errors';
import { formatINR } from '@/lib/format';
import { pageCtx } from '@/server/page';
import { getSupplierOrders } from '@/server/services/supplier-orders';

export default async function SupplierOrdersPage() {
  const { ctx, t, locale } = await pageCtx('partner');
  let data: Awaited<ReturnType<typeof getSupplierOrders>> | null = null;
  try { data = await getSupplierOrders(ctx); } catch (error) { if (!(error instanceof AppError && ['FORBIDDEN', 'NOT_A_SUPPLIER'].includes(error.code))) throw error; }
  if (!data) return (<><PageHeader title={t('nav.supplierOrders')} /><Alert tone="amber">{t('err.NOT_A_SUPPLIER')}</Alert></>);
  return (
    <>
      <PageHeader title={t('nav.supplierOrders')} subtitle={t('mk.po.supplierSubtitle')} />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t('mk.po.ledgerTotal')} value={formatINR(data.ledger.total, locale)} />
        <Stat label={t('mk.po.ledgerPaid')} value={formatINR(data.ledger.paid, locale)} />
        <Stat label={t('mk.po.ledgerOutstanding')} value={formatINR(data.ledger.outstanding, locale)} />
      </div>
      <Section title={t('mk.po.score')} description={t('mk.po.scoreHint')} className="mb-5"><SupplierScoreBadge t={t} score={data.score} detailed /></Section>
      <Section><SupplierPurchaseOrders t={t} locale={locale} pos={data.orders} /></Section>
    </>
  );
}
