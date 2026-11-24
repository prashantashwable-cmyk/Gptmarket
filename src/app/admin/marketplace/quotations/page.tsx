import Link from 'next/link';
import { CompatBadge } from '@/components/market/views';
import { EmptyState, PageHeader, Section, StatusBadge, Table, Tabs, Td, Th } from '@/components/ui';
import { MARKET_QUOTATION_STATUS } from '@/lib/enums';
import { formatDate, formatINR } from '@/lib/format';
import { load, pageCtx, readParams, type SearchParams } from '@/server/page';
import { listMarketQuotations } from '@/server/services/market-quotes';

export default async function AdminMarketQuotations({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, t, locale } = await pageCtx('admin');
  const p = await readParams(searchParams);
  const status = (MARKET_QUOTATION_STATUS as readonly string[]).includes(p.status ?? '') ? p.status : undefined;
  const rows = await load(() => listMarketQuotations(ctx, { status }));
  const tabs = [{ key: 'ALL', label: t('common.all'), href: '/admin/marketplace/quotations' },
    ...['PENDING_ENGINEERING', 'PENDING_OWNER_APPROVAL', 'ESTIMATE', 'ISSUED', 'ACCEPTED'].map((s) => ({ key: s, label: t(`e.marketQuotationStatus.${s}`), href: `/admin/marketplace/quotations?status=${s}` }))];
  return (
    <>
      <PageHeader title={t('mk.adm.quotations')} subtitle={t('mk.adm.quotationsHint')} back={{ href: '/admin/marketplace', label: t('nav.marketplace') }} />
      <Tabs tabs={tabs} active={status ?? 'ALL'} />
      <Section className="mt-4">
        {rows.length === 0 ? <EmptyState title={t('common.noData')} /> : (
          <Table>
            <thead><tr><Th>{t('mk.adm.number')}</Th><Th>{t('mk.quote.project')}</Th><Th>{t('common.status')}</Th><Th>{t('mk.cmp.compat')}</Th><Th>{t('mk.price.totalEstimated')}</Th><Th>{t('mk.adm.valid')}</Th></tr></thead>
            <tbody>{rows.map((q) => (
              <tr key={q.id}>
                <Td><Link href={`/admin/marketplace/quotations/${q.id}`} className="font-medium text-brand-700 hover:underline">{q.quotation_number}</Link><span className="block text-xs text-slate-500">v{q.version_no} · {q.price_basis ? t(`e.priceBasis.${q.price_basis}`) : ''}</span></Td>
                <Td>{q.project_name}<span className="block text-xs text-slate-500">{q.customer} · {q.lead_number}</span></Td>
                <Td><StatusBadge value={q.status} label={t(`e.marketQuotationStatus.${q.status}`)} />{q.execution_model && <span className="block text-xs text-slate-500">{t(`e.executionModel.${q.execution_model}`)}</span>}</Td>
                <Td><CompatBadge t={t} status={q.compat_status} /></Td>
                <Td className="tabular-nums">{formatINR(q.total_payable)}</Td>
                <Td>{formatDate(q.valid_until, locale)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
