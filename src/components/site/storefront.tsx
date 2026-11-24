import { localized } from '@/lib/localized';
import Link from 'next/link';
import {
  ArrowRight, BadgeCheck, Building2, CheckCircle2, ChevronDown, CircleAlert, CircleCheck, CircleX, ClipboardCheck, Factory, FileSignature, HardHat,
  Languages, Lock, MapPin, Paintbrush, Ruler, ShieldCheck, ShoppingCart, Sparkles, Store, Wrench,
} from 'lucide-react';
import type { TFunction } from '@/i18n';
import { ZONES, type Locale } from '@/lib/enums';
import { cn } from '@/lib/format';
import { LinkButton } from '@/components/ui';
import type { Rec } from '@/server/db';

const SHOP = '/customer/shop';

/** Decorative lift car (inline SVG, theme tokens only). */
function LiftArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 300" className={className} aria-hidden>
      <rect x="20" y="10" width="180" height="280" rx="14" className="fill-brand-900 stroke-brand-700" strokeWidth="2" />
      <rect x="78" y="22" width="64" height="18" rx="4" className="fill-brand-950" />
      <text x="110" y="36" textAnchor="middle" className="fill-accent-400" fontSize="13" fontWeight="700" fontFamily="monospace">▲ 5</text>
      <rect x="38" y="52" width="144" height="222" rx="6" className="fill-slate-300" />
      <rect x="40" y="54" width="69" height="218" rx="4" className="fill-slate-200" />
      <rect x="111" y="54" width="69" height="218" rx="4" className="fill-slate-200" />
      <path d="M109 54v218M111 54v218" className="stroke-slate-400" strokeWidth="1.5" />
      <rect x="52" y="70" width="45" height="186" rx="3" className="fill-slate-100" opacity="0.6" />
      <rect x="123" y="70" width="45" height="186" rx="3" className="fill-slate-100" opacity="0.6" />
      <rect x="186" y="140" width="8" height="40" rx="3" className="fill-brand-700" />
      <circle cx="190" cy="150" r="2.5" className="fill-accent-400" />
      <circle cx="190" cy="170" r="2.5" className="fill-accent-400" />
      <path d="M20 282h180" className="stroke-accent-500" strokeWidth="3" />
    </svg>
  );
}

function HeroCard({ t }: { t: TFunction }) {
  const rows = [['cabin', 'cabinValue'], ['floor', 'floorValue'], ['panel', 'panelValue']] as const;
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-4 rounded-[2rem] bg-accent-400/20 blur-2xl" aria-hidden />
      <div className="relative overflow-hidden rounded-3xl border border-hero-line bg-surface text-slate-900 shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
          <p className="text-sm font-semibold">{t('store.hero.cardTitle')}</p>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{t('store.hero.cardExample')}</span>
        </div>
        <div className="flex gap-4 p-5">
          <LiftArt className="h-40 w-28 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-wider text-accent-600 uppercase">{t('store.hero.cardPackage')}</p>
            <p className="mt-0.5 text-xs text-slate-600">{t('store.hero.cardStops')}</p>
            <dl className="mt-3 space-y-2 text-xs">
              {rows.map(([k, v]) => (
                <div key={k}><dt className="text-slate-500">{t(`store.hero.cardRows.${k}`)}</dt><dd className="font-medium text-slate-900">{t(`store.hero.cardRows.${v}`)}</dd></div>
              ))}
            </dl>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-200 text-xs">
          <div className="bg-surface px-4 py-3"><p className="text-slate-500">{t('store.hero.cardCheck')}</p>
            <p className="mt-0.5 inline-flex items-center gap-1 font-semibold text-emerald-700"><CircleCheck className="size-3.5" aria-hidden />{t('store.hero.cardCheckValue')}</p></div>
          <div className="bg-surface px-4 py-3"><p className="text-slate-500">{t('store.hero.cardPrice')}</p>
            <p className="mt-0.5 font-semibold text-brand-800">{t('store.hero.cardPriceValue')}</p></div>
        </div>
      </div>
    </div>
  );
}

export function StoreHero({ t }: { t: TFunction }) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-hero-from via-hero-via to-hero-to text-hero-fg">
      <div className="pointer-events-none absolute -top-40 right-0 size-[32rem] rounded-full bg-brand-500/30 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-48 -left-24 size-[26rem] rounded-full bg-accent-500/15 blur-3xl" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 lg:grid-cols-[1.15fr_1fr] lg:py-20">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-hero-line bg-hero-tile px-3 py-1 text-xs font-semibold">
            <MapPin className="size-3.5 text-accent-400" aria-hidden /> {t('store.hero.badge')}
          </p>
          <h1 className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
            {t('store.hero.title')}
            <span className="mt-2 block bg-gradient-to-r from-accent-400 to-accent-500 bg-clip-text text-transparent">{t('store.hero.titleAccent')}</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-hero-muted sm:text-lg">{t('store.hero.body')}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <LinkButton href={SHOP} variant="accent" size="lg" className="rounded-full" data-testid="hero-cta"><ShoppingCart className="size-5" aria-hidden />{t('store.hero.primary')}</LinkButton>
            <Link href="/enquiry" className="inline-flex items-center justify-center gap-2 rounded-full border border-hero-line px-6 py-3 text-base font-medium text-hero-fg hover:bg-hero-tile">
              {t('store.hero.secondary')} <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <p className="mt-4 text-sm text-hero-muted">{t('store.hero.note')}</p>
        </div>
        <HeroCard t={t} />
      </div>
    </section>
  );
}

export function TrustStrip({ t }: { t: TFunction }) {
  const items = [
    { icon: BadgeCheck, k: 'approved' }, { icon: Lock, k: 'safety' }, { icon: ClipboardCheck, k: 'engineer' }, { icon: Languages, k: 'language' },
  ] as const;
  return (
    <section className="border-b border-slate-200 bg-surface">
      <ul className="mx-auto grid max-w-6xl gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ icon: Icon, k }) => (
          <li key={k} className="flex items-start gap-3 bg-surface px-4 py-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon className="size-5" aria-hidden /></span>
            <span><span className="block text-sm font-semibold text-slate-900">{t(`store.trust.${k}`)}</span><span className="block text-xs text-slate-600">{t(`store.trust.${k}Body`)}</span></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TIER: Record<string, { ring: string; band: string; icon: typeof Sparkles }> = {
  BASIC: { ring: 'border-slate-200', band: 'from-slate-100 to-slate-200 text-slate-900', icon: Building2 },
  STANDARD: { ring: 'border-brand-300', band: 'from-brand-100 to-brand-200 text-brand-950', icon: CheckCircle2 },
  PREMIUM: { ring: 'border-brand-600', band: 'from-brand-800 to-brand-950 text-on-brand', icon: Sparkles },
  LUXURY: { ring: 'border-accent-500', band: 'from-accent-400 to-accent-600 text-on-accent', icon: Sparkles },
};

function Heading({ title, body, center = false }: { title: string; body?: string; center?: boolean }) {
  return (
    <div className={cn('max-w-2xl', center && 'mx-auto text-center')}>
      <span className={cn('block h-1 w-12 rounded-full bg-accent-500', center && 'mx-auto')} aria-hidden />
      <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">{title}</h2>
      {body && <p className="mt-2 text-slate-600">{body}</p>}
    </div>
  );
}

/** Package cards from the live published package versions (no hard-coded features or prices). */
export function PackagesSection({ t, locale, packages }: { t: TFunction; locale: Locale; packages: Rec[] }) {
  return (
    <section id="packages" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <Heading title={t('store.pkg.title')} body={t('store.pkg.body')} />
        {packages.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-surface p-6 text-center">
            <p className="text-slate-700">{t('store.pkg.soon')}</p>
            <LinkButton href="/enquiry" className="mt-4 rounded-full">{t('store.hero.secondary')}</LinkButton>
          </div>
        ) : (
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {packages.map((p) => {
              const tier = TIER[p.code] ?? TIER.BASIC;
              const Icon = tier.icon;
              const features = String(localized(p, 'features', locale) ?? '').split('\n').map((f) => f.trim()).filter(Boolean).slice(0, 4);
              return (
                <li key={p.code} className={cn('flex flex-col overflow-hidden rounded-2xl border-2 bg-surface shadow-sm transition-shadow hover:shadow-xl', tier.ring)}>
                  <div className={cn('bg-gradient-to-br px-5 py-5', tier.band)}>
                    <Icon className="size-6 opacity-80" aria-hidden />
                    <h3 className="mt-3 text-xl font-bold">{t(`store.pkg.items.${p.code}.name`)}</h3>
                    <p className="text-sm opacity-80">{t(`store.pkg.items.${p.code}.tagline`)}</p>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <p className="text-xs font-semibold text-brand-700">{t(`store.pkg.items.${p.code}.best`)}</p>
                    <ul className="mt-3 space-y-2 text-sm text-slate-700">
                      {features.map((f) => <li key={f} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />{f}</li>)}
                      <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />{t('store.pkg.warranty', { months: p.warranty_months })}</li>
                    </ul>
                    <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{t('store.pkg.priceNote')}</p>
                    <LinkButton href={SHOP} variant={p.code === 'LUXURY' ? 'accent' : 'primary'} className="mt-4 w-full rounded-full">{t('store.pkg.cta')} <ArrowRight className="size-4" aria-hidden /></LinkButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export function HowSection({ t }: { t: TFunction }) {
  const steps = [Building2, Store, Paintbrush, ClipboardCheck, Ruler, HardHat];
  return (
    <section id="how" className="scroll-mt-20 bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <Heading title={t('store.how.title')} body={t('store.how.body')} />
        <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((Icon, i) => (
            <li key={i} className="relative rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-brand-900 text-sm font-bold text-accent-400">{i + 1}</span>
                <Icon className="size-5 text-brand-700" aria-hidden />
              </div>
              <h3 className="mt-4 font-semibold text-slate-900">{t(`store.how.s${i + 1}`)}</h3>
              <p className="mt-1.5 text-sm text-slate-600">{t(`store.how.s${i + 1}Body`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function CustomiseSection({ t }: { t: TFunction }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <Heading title={t('store.customise.title')} body={t('store.customise.body')} />
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-6">
          <p className="flex items-center gap-2 font-semibold text-brand-900"><Paintbrush className="size-5" aria-hidden />{t('store.customise.yours')}</p>
          <ul className="mt-4 flex flex-wrap gap-2">{t('store.customise.yoursItems').split(' · ').map((x) => (
            <li key={x} className="rounded-full border border-brand-200 bg-surface px-3 py-1.5 text-sm text-slate-800">{x}</li>
          ))}</ul>
        </div>
        <div className="rounded-2xl bg-ink p-6 text-ink-fg">
          <p className="flex items-center gap-2 font-semibold"><Lock className="size-5 text-accent-400" aria-hidden />{t('store.customise.fixed')}</p>
          <ul className="mt-4 flex flex-wrap gap-2">{t('store.customise.fixedItems').split(' · ').map((x) => (
            <li key={x} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-sm text-ink-muted"><ShieldCheck className="size-3.5 text-accent-400" aria-hidden />{x}</li>
          ))}</ul>
        </div>
      </div>
    </section>
  );
}

export function SafetySection({ t }: { t: TFunction }) {
  const levels = [
    { k: 'green', icon: CircleCheck, cls: 'border-emerald-200 bg-emerald-50', ic: 'text-emerald-600' },
    { k: 'yellow', icon: CircleAlert, cls: 'border-amber-200 bg-amber-50', ic: 'text-amber-600' },
    { k: 'red', icon: CircleX, cls: 'border-red-200 bg-red-50', ic: 'text-red-600' },
  ] as const;
  return (
    <section id="safety" className="scroll-mt-20 bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <Heading title={t('store.safety.title')} />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {levels.map(({ k, icon: Icon, cls, ic }) => (
            <div key={k} className={cn('rounded-2xl border p-5', cls)}>
              <Icon className={cn('size-7', ic)} aria-hidden />
              <h3 className="mt-3 font-semibold text-slate-900">{t(`store.safety.${k}`)}</h3>
              <p className="mt-1.5 text-sm text-slate-700">{t(`store.safety.${k}Body`)}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"><FileSignature className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />{t('store.safety.note')}</p>
      </div>
    </section>
  );
}

export function ModelsSection({ t }: { t: TFunction }) {
  return (
    <section id="models" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-16">
      <Heading title={t('store.models.title')} body={t('store.models.body')} />
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {(['aiec', 'market'] as const).map((k) => (
          <article key={k} className={cn('rounded-2xl p-6', k === 'aiec' ? 'bg-gradient-to-br from-brand-900 to-brand-950 text-on-brand' : 'border border-slate-200 bg-surface')}>
            {k === 'aiec' ? <Building2 className="size-7 text-accent-400" aria-hidden /> : <Store className="size-7 text-brand-700" aria-hidden />}
            <h3 className="mt-3 text-xl font-bold">{t(`store.models.${k}`)}</h3>
            <p className={cn('mt-2 text-sm', k === 'aiec' ? 'text-ink-muted' : 'text-slate-600')}>{t(`store.models.${k}Body`)}</p>
          </article>
        ))}
      </div>
      <ul className="mt-5 grid gap-2 sm:grid-cols-3">
        {(['p1', 'p2', 'p3'] as const).map((k) => (
          <li key={k} className="flex items-start gap-2 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />{t(`store.models.${k}`)}</li>
        ))}
      </ul>
    </section>
  );
}

export function JoinSection({ t }: { t: TFunction }) {
  return (
    <section id="partners" className="scroll-mt-20 bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <Heading title={t('store.join.title')} />
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {([['supplier', Factory], ['partner', Wrench]] as const).map(([k, Icon]) => (
            <article key={k} className="flex flex-col rounded-2xl border border-slate-200 p-6">
              <Icon className="size-7 text-brand-700" aria-hidden />
              <h3 className="mt-3 text-lg font-semibold text-slate-900">{t(`store.join.${k}`)}</h3>
              <p className="mt-2 flex-1 text-sm text-slate-600">{t(`store.join.${k}Body`)}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <LinkButton href="/onboarding/partner" size="md" className="rounded-full">{t('store.join.cta')}</LinkButton>
                <LinkButton href="/login" variant="secondary" size="md" className="rounded-full">{t('store.join.signIn')}</LinkButton>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AreasStrip({ t }: { t: TFunction }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <h2 className="text-lg font-bold text-slate-900">{t('landing.areasTitle')}</h2>
      <ul className="mt-4 flex flex-wrap gap-2">
        {ZONES.map((zone) => (
          <li key={zone} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-surface px-3.5 py-1.5 text-sm font-medium text-slate-800">
            <MapPin className="size-3.5 text-accent-600" aria-hidden /> {t(`zone.${zone}`)}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-slate-600">{t('landing.areasBody')}</p>
    </section>
  );
}

export function FaqSection({ t }: { t: TFunction }) {
  return (
    <section id="faq" className="scroll-mt-20 bg-surface">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Heading title={t('store.faq.title')} center />
        <div className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <details key={n} className="group px-5">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-4 font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                {t(`store.faq.q${n}`)}<ChevronDown className="size-5 shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="pb-5 text-sm text-slate-700">{t(`store.faq.a${n}`)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta({ t }: { t: TFunction }) {
  return (
    <section className="px-4 py-14">
      <div className="relative mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 overflow-hidden rounded-3xl bg-gradient-to-r from-brand-950 via-brand-900 to-brand-800 px-6 py-10 text-on-brand md:flex-row md:items-center md:px-10">
        <div className="pointer-events-none absolute -right-10 -bottom-16 size-64 rounded-full bg-accent-500/25 blur-3xl" aria-hidden />
        <div className="relative">
          <h2 className="text-2xl font-extrabold">{t('store.cta.title')}</h2>
          <p className="mt-1 text-ink-muted">{t('store.cta.body')}</p>
        </div>
        <LinkButton href={SHOP} variant="accent" size="lg" className="relative rounded-full">{t('store.cta.button')} <ArrowRight className="size-4" aria-hidden /></LinkButton>
      </div>
    </section>
  );
}
