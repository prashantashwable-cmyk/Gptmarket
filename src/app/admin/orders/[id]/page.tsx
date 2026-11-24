import { AiecFinanceView } from '@/components/market/aiec-finance';
import { StaffPurchaseOrders } from '@/components/market/purchase-orders';
import { OrderView } from '@/components/views/order-view';
import { PageHeader } from '@/components/ui';
import { load, pageCtx } from '@/server/page';
import { getAiecFinance } from '@/server/services/aiec-contract';
import { getOrder } from '@/server/services/orders';
import { getOrderPurchaseOrders } from '@/server/services/supplier-orders';

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, t, locale } = await pageCtx('admin');
  const data = await load(() => getOrder(ctx, id));
  const finance = await load(() => getAiecFinance(ctx, id));
  const pos = await load(() => getOrderPurchaseOrders(ctx, id));
  return (<><PageHeader title={`${t('f.order')} ${data.order.order_number}`} back={{ href: '/admin/orders', label: t('nav.orders') }} /><OrderView ctx={ctx} t={t} locale={locale} data={data} mode="staff" />{finance && <AiecFinanceView ctx={ctx} t={t} locale={locale} data={finance} />}
    {pos && <StaffPurchaseOrders ctx={ctx} t={t} locale={locale} orderId={id} orderStatus={data.order.status} pos={pos} />}</>);
}
