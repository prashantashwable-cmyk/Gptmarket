import { createShopProjectAction } from '@/app/actions/market';
import { SpecForm } from '@/components/market/spec-form';
import { PageHeader } from '@/components/ui';
import { pageCtx } from '@/server/page';
import { listZones } from '@/server/services/leads';

export default async function NewShopProject() {
  const { t } = await pageCtx('customer');
  const zones = await listZones();
  return (
    <>
      <PageHeader title={t('mk.home.create')} subtitle={t('mk.new.subtitle')} back={{ href: '/customer/shop', label: t('nav.liftShop') }} />
      <SpecForm action={createShopProjectAction} mode="create" zones={zones.map((z) => ({ id: z.id, code: z.code }))} />
    </>
  );
}
