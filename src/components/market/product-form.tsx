'use client';

import { useState } from 'react';
import { ActionForm, CheckboxField, Field, SelectField, SubmitButton, TextareaField, type FormAction } from '@/components/ui/form';
import { useT } from '@/i18n/client';
import { COMPONENT_CATEGORY, PRICE_UNIT, SAFETY_CRITICAL_CATEGORIES, type ComponentCategory } from '@/lib/enums';

/** Technical attributes required per category (mirrors productSpecSchemas in src/lib/compatibility.ts). */
const SPEC_FIELDS: Partial<Record<ComponentCategory, Array<{ key: string; kind: 'number' | 'drive' | 'drives' }>>> = {
  MACHINE: [{ key: 'maxLoadKg', kind: 'number' }, { key: 'maxSpeedMps', kind: 'number' }, { key: 'powerKw', kind: 'number' }, { key: 'driveType', kind: 'drive' }],
  CONTROLLER: [{ key: 'maxStops', kind: 'number' }, { key: 'maxSpeedMps', kind: 'number' }, { key: 'supportedDrives', kind: 'drives' }],
  CAR_CABIN: [{ key: 'carWidthMm', kind: 'number' }, { key: 'carDepthMm', kind: 'number' }, { key: 'ratedLoadKg', kind: 'number' }],
  CAR_DOOR: [{ key: 'clearOpeningMm', kind: 'number' }],
  LANDING_DOOR: [{ key: 'clearOpeningMm', kind: 'number' }],
  SAFETY_GEAR: [{ key: 'maxSpeedMps', kind: 'number' }, { key: 'maxLoadKg', kind: 'number' }],
  GOVERNOR: [{ key: 'maxSpeedMps', kind: 'number' }],
  BUFFERS: [{ key: 'maxSpeedMps', kind: 'number' }],
};
const DRIVES = ['GEARLESS_PMSM', 'GEARED', 'HYDRAULIC'] as const;

export function SupplierProductForm({ action }: { action: FormAction }) {
  const t = useT();
  const [category, setCategory] = useState<ComponentCategory>('CABIN_FINISH');
  const fields = SPEC_FIELDS[category] ?? [];
  return (
    <ActionForm action={action} className="space-y-3">
      <SelectField name="categoryCode" label={t('mk.rev.category')} required value={category} onChange={(e) => setCategory(e.target.value as ComponentCategory)}
        options={COMPONENT_CATEGORY.map((c) => ({ value: c, label: t(`e.componentCategory.${c}`) }))} />
      {SAFETY_CRITICAL_CATEGORIES.includes(category) && <p className="text-xs font-medium text-red-700">{t('mk.sup.safetyNote')}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="brand" label={t('mk.sup.brand')} required />
        <Field name="model" label={t('mk.sup.model')} required />
      </div>
      <Field name="name" label={t('mk.rev.product')} required />
      <TextareaField name="description" label={t('mk.sup.description')} rows={2} />
      {fields.length > 0 && (
        <fieldset className="rounded-lg bg-slate-50 p-3"><legend className="px-1 text-sm font-medium">{t('mk.sup.technical')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">{fields.map((f) => f.kind === 'number' ? (
            <Field key={f.key} name={`spec_${f.key}`} label={t(`mk.sup.spec.${f.key}`)} type="number" step="any" required />
          ) : f.kind === 'drive' ? (
            <SelectField key={f.key} name={`spec_${f.key}`} label={t(`mk.sup.spec.${f.key}`)} required options={DRIVES.map((d) => ({ value: d, label: t(`mk.sup.drive.${d}`) }))} />
          ) : (
            <fieldset key={f.key}><legend className="mb-1 text-sm font-medium">{t(`mk.sup.spec.${f.key}`)}</legend>
              {DRIVES.map((d) => <CheckboxField key={d} name={`spec_${f.key}[]`} value={d} label={t(`mk.sup.drive.${d}`)} />)}</fieldset>
          ))}</div>
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField name="priceUnit" label={t('mk.sup.priceUnit')} options={PRICE_UNIT.map((u) => ({ value: u, label: t(`e.priceUnit.${u}`) }))} defaultValue="EACH" />
        <Field name="warrantyMonths" type="number" label={t('mk.sup.warranty')} defaultValue={12} required />
        <Field name="deliveryDays" type="number" label={t('mk.sup.delivery')} defaultValue={14} required />
        <Field name="stockQty" type="number" label={t('mk.sup.stock')} defaultValue={0} required />
      </div>
      <Field name="image" type="file" accept="image/jpeg,image/png,image/webp" label={t('mk.sup.image')} hint={t('f.fileHint')} />
      <Field name="document" type="file" accept="application/pdf" label={t('mk.sup.datasheet')} hint={t('f.fileHint')} />
      <SubmitButton>{t('mk.sup.save')}</SubmitButton>
    </ActionForm>
  );
}
