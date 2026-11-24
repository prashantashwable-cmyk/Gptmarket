import Link from 'next/link';
import { createPackageDraftAction } from '@/app/actions/market';
import { Card, PageHeader, StatusBadge } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/form';
import { formatDate } from '@/lib/format';
import { load, pageCtx } from '@/server/page';
import { listPackagesAdmin } from '@/server/services/packages';

export default async function PackagesAdmin() {
  const { ctx, t, locale } = await pageCtx('admin');
  const packages = await load(() => listPackagesAdmin(ctx));
  const canManage = ctx.permissions.has('package.manage');
  return (
    <>
      <PageHeader title={t('mk.adm.packages')} subtitle={t('mk.pkg.subtitle')} back={{ href: '/admin/marketplace', label: t('nav.marketplace') }} />
      <ul className="grid gap-4 md:grid-cols-2">{packages.map((p) => (
        <li key={p.id}><Card className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-semibold text-slate-900">{t(`e.packageCode.${p.code}`)}</h2>
            {canManage && !p.versions.some((v: { status: string }) => v.status === 'DRAFT') && (
              <ActionForm action={createPackageDraftAction} hideSuccess><input type="hidden" name="id" value={p.id} /><SubmitButton size="sm" variant="secondary">{t('mk.pkg.newDraft')}</SubmitButton></ActionForm>
            )}
          </div>
          {p.versions.length === 0 ? <p className="mt-2 text-sm text-slate-600">{t('mk.pkg.none')}</p> : (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">{p.versions.map((v: Record<string, string>) => (
              <li key={v.id}><Link href={`/admin/marketplace/packages/${v.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-slate-50">
                <span>v{v.version_no} · {v.title}<span className="block text-xs text-slate-500">{t('mk.pkg.slots', { count: v.slots })}{v.published_at ? ` · ${formatDate(v.published_at, locale)}` : ''}</span></span>
                <StatusBadge value={v.status} label={t(`e.packageStatus.${v.status}`)} />
              </Link></li>
            ))}</ul>
          )}
        </Card></li>
      ))}</ul>
    </>
  );
}
