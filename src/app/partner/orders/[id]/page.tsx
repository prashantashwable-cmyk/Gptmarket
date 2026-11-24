import { AiecFinanceView } from '@/components/market/aiec-finance';
import { OrderView } from '@/components/views/order-view';
import { PageHeader } from '@/components/ui';
import { load, pageCtx } from '@/server/page';
import { getAiecFinance } from '@/server/services/aiec-contract';
import { getOrder } from '@/server/services/orders';

export default async function PartnerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, t, locale } = await pageCtx('partner');
  const data = await load(() => getOrder(ctx, id));
  const finance = await load(() => getAiecFinance(ctx, id));
  return (<><PageHeader title={`${t('f.order')} ${data.order.order_number}`} back={{ href: '/partner/orders', label: t('nav.orders') }} /><OrderView ctx={ctx} t={t} locale={locale} data={data} mode="partner" />{finance && <AiecFinanceView ctx={ctx} t={t} locale={locale} data={finance} />}</>);
}
