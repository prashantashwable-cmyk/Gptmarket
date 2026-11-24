'use client';

import type { ReactNode } from 'react';
import { Building2, Gauge, Ruler } from 'lucide-react';
import { ActionForm, CheckboxField, Field, SelectField, SubmitButton, TextareaField, type FormAction } from '@/components/ui/form';
import { useT } from '@/i18n/client';
import { PRIVACY_NOTICE_VERSION } from '@/lib/config';
import { BUILDING_AGE, BUILDING_TYPE, LIFT_PURPOSE, POWER_SUPPLY, USAGE_FREQUENCY } from '@/lib/enums';

type Spec = Record<string, string | number | boolean | null | undefined>;

function Block({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-xl border border-slate-200 bg-surface p-4 sm:p-5">
      <legend className="flex items-center gap-2 px-1 text-base font-semibold text-slate-900">{icon}{title}</legend>
      {hint && <p className="mb-3 text-sm text-slate-600">{hint}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Building details (screen 2) and lift requirements (screen 3). `mode="edit"` updates an existing project. */
export function SpecForm({ action, zones, mode, leadId, spec }: {
  action: FormAction; zones?: Array<{ id: string; code: string }>; mode: 'create' | 'edit'; leadId?: string; spec?: Spec | null;
}) {
  const t = useT();
  const opts = (group: string, values: readonly string[]) => values.map((v) => ({ value: v, label: t(`e.${group}.${v}`) }));
  const d = (k: string) => (spec?.[k] === null || spec?.[k] === undefined ? undefined : String(spec[k]));
  const num = { type: 'number', inputMode: 'numeric' as const };
  return (
    <ActionForm action={action} className="space-y-5" resetOnSuccess={false}>
      {leadId && <input type="hidden" name="leadId" value={leadId} />}
      {mode === 'create' && (
        <Block icon={<Building2 className="size-5 text-brand-600" aria-hidden />} title={t('mk.new.building')} hint={t('mk.new.buildingHint')}>
          <Field name="projectName" label={t('enquiry.projectName')} required />
          <SelectField name="zoneId" label={t('enquiry.zone')} required placeholder={t('common.select')} options={(zones ?? []).map((z) => ({ value: z.id, label: t(`zone.${z.code}`) }))} hint={t('mk.new.zoneHint')} />
          <TextareaField name="address" label={t('enquiry.address')} required rows={2} wrapperClassName="sm:col-span-2" />
          <SelectField name="buildingType" label={t('enquiry.buildingType')} required options={opts('buildingType', BUILDING_TYPE)} placeholder={t('common.select')} />
          <SelectField name="buildingAge" label={t('mk.spec.buildingAge')} required options={opts('buildingAge', BUILDING_AGE)} defaultValue="NEW" />
        </Block>
      )}
      {mode === 'edit' && <input type="hidden" name="buildingAge" value={d('building_age') ?? 'NEW'} />}

      <Block icon={<Ruler className="size-5 text-brand-600" aria-hidden />} title={t('mk.new.shaft')} hint={t('mk.new.shaftHint')}>
        <Field name="floors" label={t('mk.spec.floors')} {...num} min={1} max={100} defaultValue={d('floors')} />
        <Field name="stops" label={t('mk.spec.stops')} {...num} min={2} max={100} defaultValue={d('stops')} hint={t('mk.new.stopsHint')} />
        <Field name="shaftWidthMm" label={t('mk.spec.shaftWidthMm')} {...num} min={300} max={10000} defaultValue={d('shaft_width_mm')} />
        <Field name="shaftDepthMm" label={t('mk.spec.shaftDepthMm')} {...num} min={300} max={10000} defaultValue={d('shaft_depth_mm')} />
        <Field name="pitDepthMm" label={t('mk.spec.pitDepthMm')} {...num} min={0} max={10000} defaultValue={d('pit_depth_mm')} />
        <Field name="overheadMm" label={t('mk.spec.overheadMm')} {...num} min={0} max={20000} defaultValue={d('overhead_mm')} />
        <SelectField name="powerSupply" label={t('mk.spec.powerSupply')} options={opts('powerSupply', POWER_SUPPLY)} defaultValue={d('power_supply') ?? 'UNKNOWN'} />
        <Field name="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" label={t('mk.new.photos')} hint={t('mk.new.photosHint')} />
      </Block>

      <Block icon={<Gauge className="size-5 text-brand-600" aria-hidden />} title={t('mk.new.requirements')} hint={t('mk.new.requirementsHint')}>
        <SelectField name="purpose" label={t('mk.spec.purpose')} required options={opts('liftPurpose', LIFT_PURPOSE)} defaultValue={d('purpose') ?? 'PASSENGER'} />
        <Field name="persons" label={t('mk.spec.persons')} {...num} min={1} max={50} defaultValue={d('persons')} />
        <Field name="ratedLoadKg" label={t('mk.spec.ratedLoadKg')} {...num} min={50} max={10000} defaultValue={d('rated_load_kg')} hint={t('mk.new.loadHint')} />
        <Field name="speedMps" label={t('mk.spec.speedMps')} type="number" inputMode="decimal" step="0.1" min={0.1} max={10} defaultValue={d('speed_mps') ?? '1.0'} />
        <SelectField name="usageFrequency" label={t('mk.spec.usageFrequency')} options={opts('usageFrequency', USAGE_FREQUENCY)} defaultValue={d('usage_frequency') ?? 'MEDIUM'} />
        <CheckboxField name="accessibility" label={t('mk.spec.accessibility')} hint={t('mk.new.accessibilityHint')} defaultChecked={spec?.accessibility === true} wrapperClassName="self-end" />
        <TextareaField name="specialRequirements" label={t('mk.spec.specialRequirements')} rows={2} wrapperClassName="sm:col-span-2" defaultValue={d('special_requirements')} />
      </Block>

      {mode === 'create' && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <CheckboxField name="consentContact" required label={t('enquiry.consentContact')} />
          <CheckboxField name="consentPrivacy" required label={t('enquiry.consentPrivacy', { version: PRIVACY_NOTICE_VERSION })} />
        </div>
      )}
      <p className="text-xs text-slate-600">{t('mk.new.engineerNote')}</p>
      <SubmitButton size="lg" className="w-full sm:w-auto">{mode === 'create' ? t('mk.new.submit') : t('common.save')}</SubmitButton>
    </ActionForm>
  );
}
