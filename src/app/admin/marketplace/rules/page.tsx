import { activateRulesAction, createCompatDraftAction, createPricingDraftAction } from '@/app/actions/market';
import { Alert, Badge, PageHeader, Section, StatusBadge } from '@/components/ui';
import { ActionForm, Field, SubmitButton, TextareaField } from '@/components/ui/form';
import { DEFAULT_COMPAT_PARAMS } from '@/lib/compatibility';
import { formatDate } from '@/lib/format';
import type { PricingParams } from '@/lib/pricing';
import { load, pageCtx } from '@/server/page';
import { listRules } from '@/server/services/rules';

const PRICING_FIELDS = ['installationBase', 'installationPerStop', 'transportDefault', 'siteWorkBase', 'siteWorkPerStop', 'overheadPercent', 'marginPercent',
  'minMarginPercent', 'maxDiscountPercent', 'gstPercent', 'floorHeightM', 'quoteValidityDays'] as const;

export default async function RulesPage() {
  const { ctx, t, locale } = await pageCtx('admin');
  const { pricing, compatibility } = await load(() => listRules(ctx));
  const canDraftPricing = ctx.permissions.has('pricing.manage') || ctx.permissions.has('pricing.approve');
  const canActivatePricing = ctx.permissions.has('pricing.approve');
  const canCompat = ctx.permissions.has('engineering.approve');
  const latest = (pricing[0]?.params ?? null) as PricingParams | null;
  const activeCompat = compatibility.find((c) => c.status === 'ACTIVE') ?? compatibility[0];
  return (
    <>
      <PageHeader title={t('mk.adm.rules')} subtitle={t('mk.rules.subtitle')} back={{ href: '/admin/marketplace', label: t('nav.marketplace') }} />
      <Alert tone="amber" className="mb-4">{t('mk.rules.warning')}</Alert>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t('mk.rules.pricing')} description={t('mk.rules.pricingHint')}>
          {pricing.length === 0 && <Alert tone="red" className="mb-3">{t('mk.exc.pricingRulesMissing')}</Alert>}
          <ul className="space-y-2">{pricing.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">v{r.version_no} {r.is_demo && <Badge tone="amber">DEMO</Badge>}</span>
                <StatusBadge value={r.status} label={t(`e.ruleStatus.${r.status}`)} />
              </div>
              <p className="mt-1 text-xs text-slate-600">{t('mk.rules.summary', { margin: r.params.marginPercent, min: r.params.minMarginPercent, discount: r.params.maxDiscountPercent, gst: r.params.gstPercent, overhead: r.params.overheadPercent })}</p>
              {r.note && <p className="mt-1 text-xs text-slate-500">{r.note}</p>}
              {r.activated_at && <p className="mt-1 text-xs text-slate-500">{t('mk.rules.activatedBy', { name: r.activated_by_name, date: formatDate(r.activated_at, locale) })}</p>}
              {r.status === 'DRAFT' && canActivatePricing && (
                <ActionForm action={activateRulesAction} hideSuccess className="mt-2"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="kind" value="pricing" />
                  <SubmitButton size="sm" confirm={t('mk.rules.activateConfirm')}>{t('a.activate')}</SubmitButton></ActionForm>
              )}
            </li>
          ))}</ul>
          {canDraftPricing && (
            <details className="mt-4 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium text-brand-700">{t('mk.rules.newPricing')}</summary>
              <ActionForm action={createPricingDraftAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                {PRICING_FIELDS.map((f) => <Field key={f} name={f} label={t(`mk.rules.f.${f}`)} defaultValue={latest ? String(latest[f]) : ''} required inputMode="decimal" />)}
                <TextareaField name="transportByZone" label={t('mk.rules.f.transportByZone')} hint={t('mk.rules.zoneHint')} rows={3} wrapperClassName="sm:col-span-2"
                  defaultValue={latest ? Object.entries(latest.transportByZone).map(([k, v]) => `${k}=${v}`).join('\n') : ''} />
                <TextareaField name="paymentMilestones" label={t('mk.rules.f.paymentMilestones')} hint={t('mk.rules.milestoneHint')} rows={4} wrapperClassName="sm:col-span-2"
                  defaultValue={latest ? latest.paymentMilestones.map((m) => `${m.name}=${m.percent}`).join('\n') : ''} />
                <TextareaField name="note" label={t('mk.rules.note')} rows={2} wrapperClassName="sm:col-span-2" />
                <SubmitButton size="sm">{t('mk.rules.saveDraft')}</SubmitButton>
              </ActionForm>
            </details>
          )}
        </Section>
        <Section title={t('mk.rules.compat')} description={t('mk.rules.compatHint')}>
          <ul className="space-y-2">{compatibility.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">v{r.version_no}</span><StatusBadge value={r.status} label={t(`e.ruleStatus.${r.status}`)} /></div>
              {r.note && <p className="mt-1 text-xs text-slate-500">{r.note}</p>}
              {r.activated_at && <p className="mt-1 text-xs text-slate-500">{t('mk.rules.activatedBy', { name: r.activated_by_name, date: formatDate(r.activated_at, locale) })}</p>}
              <details className="mt-1"><summary className="cursor-pointer text-xs text-brand-700">{t('mk.rules.params')}</summary>
                <pre className="mt-1 max-h-60 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(r.params, null, 2)}</pre></details>
              {r.status === 'DRAFT' && canCompat && (
                <ActionForm action={activateRulesAction} hideSuccess className="mt-2"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="kind" value="compatibility" />
                  <SubmitButton size="sm" confirm={t('mk.rules.activateConfirm')}>{t('a.activate')}</SubmitButton></ActionForm>
              )}
            </li>
          ))}</ul>
          {canCompat && (
            <details className="mt-4 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium text-brand-700">{t('mk.rules.newCompat')}</summary>
              <ActionForm action={createCompatDraftAction} className="mt-3 space-y-3">
                <TextareaField name="params" label={t('mk.rules.params')} rows={14} className="font-mono text-xs" defaultValue={JSON.stringify(activeCompat?.params ?? DEFAULT_COMPAT_PARAMS, null, 2)} />
                <TextareaField name="note" label={t('mk.rules.note')} rows={2} />
                <SubmitButton size="sm">{t('mk.rules.saveDraft')}</SubmitButton>
              </ActionForm>
            </details>
          )}
        </Section>
      </div>
    </>
  );
}
