import { notFound } from 'next/navigation';
import { addOptionAction, addSlotAction, deletePackageDraftAction, publishPackageAction, removeOptionAction, removeSlotAction, updatePackageVersionAction } from '@/app/actions/market';
import { enumOptions } from '@/components/common';
import { Alert, Badge, PageHeader, Section, StatusBadge } from '@/components/ui';
import { ActionForm, CheckboxField, Field, SelectField, SubmitButton, TextareaField } from '@/components/ui/form';
import { COMPONENT_CATEGORY, LIFT_PURPOSE, OPTION_KIND } from '@/lib/enums';
import { isUuid, load, pageCtx } from '@/server/page';
import { getPackageVersionAdmin } from '@/server/services/packages';

export default async function PackageEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { ctx, t } = await pageCtx('admin');
  const { version: v, slots, candidates } = await load(() => getPackageVersionAdmin(ctx, id));
  const draft = v.status === 'DRAFT' && ctx.permissions.has('package.manage');
  const used = new Set(slots.map((s) => s.category_code));
  return (
    <>
      <PageHeader title={`${v.title} · v${v.version_no}`} subtitle={t(`e.packageCode.${v.code}`)} back={{ href: '/admin/marketplace/packages', label: t('mk.adm.packages') }}
        actions={<StatusBadge value={v.status} label={t(`e.packageStatus.${v.status}`)} />} />
      {!draft && <Alert tone="blue" className="mb-4">{t('mk.pkg.locked')}</Alert>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title={t('mk.pkg.slotsTitle')} description={t('mk.pkg.slotsHint')}>
            <ul className="space-y-3">{slots.map((s) => (
              <li key={s.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">{t(`e.componentCategory.${s.category_code}`)}
                    {s.is_safety_critical && <Badge tone="red" className="ml-2">{t('mk.cart.safety')}</Badge>}
                    {!s.is_mandatory && <Badge tone="gray" className="ml-2">{t('mk.pkg.optional')}</Badge>}
                    {s.customer_editable && <Badge tone="blue" className="ml-2">{t('mk.pkg.editable')}</Badge>}</p>
                  {draft && <ActionForm action={removeSlotAction} hideSuccess><input type="hidden" name="id" value={s.id} /><SubmitButton size="sm" variant="ghost">{t('a.remove')}</SubmitButton></ActionForm>}
                </div>
                <ul className="mt-2 space-y-1 text-sm">{s.options.map((o: Record<string, string>) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span><Badge tone={o.kind === 'STANDARD' ? 'green' : 'gray'}>{t(`e.optionKind.${o.kind}`)}</Badge> {o.name} <span className="text-xs text-slate-500">{o.brand} {o.model} · {o.supplier}</span>
                      {(o.approval_status !== 'APPROVED' || !['APPROVED', 'PREFERRED'].includes(o.marketplace_status)) && <Badge tone="red" className="ml-1">{t('mk.cart.unavailable')}</Badge>}</span>
                    {draft && <ActionForm action={removeOptionAction} hideSuccess><input type="hidden" name="id" value={o.id} /><SubmitButton size="sm" variant="ghost">{t('a.remove')}</SubmitButton></ActionForm>}
                  </li>
                ))}</ul>
                {draft && (
                  <ActionForm action={addOptionAction} hideSuccess className="mt-2 flex flex-wrap items-end gap-1.5"><input type="hidden" name="slotId" value={s.id} />
                    <SelectField name="productId" aria-label={t('mk.rev.product')} placeholder={t('common.select')} wrapperClassName="min-w-52 flex-1"
                      options={candidates.filter((c) => c.category_code === s.category_code && !s.options.some((o: Record<string, string>) => o.product_id === c.id)).map((c) => ({ value: c.id, label: `${c.name} · ${c.brand} ${c.model} · ${c.supplier}` }))} />
                    <SelectField name="kind" aria-label={t('mk.pkg.kind')} options={enumOptions(t, 'optionKind', OPTION_KIND)} defaultValue={s.options.length ? 'UPGRADE' : 'STANDARD'} />
                    <SubmitButton size="sm" variant="secondary">{t('mk.pkg.addOption')}</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}</ul>
            {draft && (
              <ActionForm action={addSlotAction} hideSuccess className="mt-4 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3"><input type="hidden" name="versionId" value={id} />
                <SelectField name="categoryCode" label={t('mk.pkg.newSlot')} options={enumOptions(t, 'componentCategory', COMPONENT_CATEGORY.filter((c) => !used.has(c)))} placeholder={t('common.select')} />
                <CheckboxField name="isMandatory" label={t('mk.pkg.mandatory')} defaultChecked />
                <CheckboxField name="customerEditable" label={t('mk.pkg.editable')} />
                <SubmitButton size="sm">{t('mk.pkg.addSlot')}</SubmitButton>
              </ActionForm>
            )}
          </Section>
        </div>
        <div className="space-y-5">
          <Section title={t('mk.pkg.details')}>
            <ActionForm action={updatePackageVersionAction} resetOnSuccess={false} className="space-y-3"><input type="hidden" name="id" value={id} />
              <Field name="title" label={t('mk.pkg.title')} defaultValue={v.title} disabled={!draft} required />
              <TextareaField name="summary" label={t('mk.pkg.summary')} defaultValue={v.summary ?? ''} rows={2} disabled={!draft} />
              <TextareaField name="features" label={t('mk.pkg.features')} defaultValue={v.features ?? ''} rows={4} disabled={!draft} hint={t('mk.pkg.onePerLine')} />
              <TextareaField name="exclusions" label={t('mk.cat.excluded')} defaultValue={v.exclusions ?? ''} rows={3} disabled={!draft} hint={t('mk.pkg.onePerLine')} />
              <Field name="warrantyMonths" type="number" label={t('mk.pkg.warranty')} defaultValue={v.warranty_months} disabled={!draft} />
              <fieldset><legend className="mb-1 text-sm font-medium text-slate-800">{t('mk.pkg.purposes')}</legend>
                {LIFT_PURPOSE.map((p) => <CheckboxField key={p} name="eligiblePurposes[]" value={p} label={t(`e.liftPurpose.${p}`)} defaultChecked={(v.eligible_purposes ?? []).includes(p)} disabled={!draft} />)}</fieldset>
              <div className="grid grid-cols-2 gap-2">
                <Field name="minStops" type="number" label={t('mk.pkg.minStops')} defaultValue={v.min_stops} disabled={!draft} />
                <Field name="maxStops" type="number" label={t('mk.pkg.maxStops')} defaultValue={v.max_stops} disabled={!draft} />
                <Field name="minLoadKg" type="number" label={t('mk.pkg.minLoad')} defaultValue={v.min_load_kg} disabled={!draft} />
                <Field name="maxLoadKg" type="number" label={t('mk.pkg.maxLoad')} defaultValue={v.max_load_kg} disabled={!draft} />
                <Field name="maxSpeedMps" type="number" step="0.05" label={t('mk.pkg.maxSpeed')} defaultValue={v.max_speed_mps} disabled={!draft} />
              </div>
              {draft && <SubmitButton size="sm">{t('common.save')}</SubmitButton>}
            </ActionForm>
          </Section>
          {draft && (
            <Section>
              <ActionForm action={publishPackageAction}><input type="hidden" name="id" value={id} />
                <SubmitButton className="w-full" confirm={t('mk.pkg.publishConfirm')}>{t('mk.pkg.publish')}</SubmitButton></ActionForm>
              <p className="mt-2 text-xs text-slate-600">{t('mk.pkg.publishHint')}</p>
              <ActionForm action={deletePackageDraftAction} className="mt-3"><input type="hidden" name="id" value={id} />
                <SubmitButton size="sm" variant="ghost" confirm={t('mk.pkg.deleteConfirm')}>{t('mk.pkg.deleteDraft')}</SubmitButton></ActionForm>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
