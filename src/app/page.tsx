import { getT } from '@/i18n/server';
import { SiteFooter } from '@/components/site/site-footer';
import { SiteHeader } from '@/components/site/site-header';
import {
  AreasStrip, CustomiseSection, FaqSection, FinalCta, HowSection, JoinSection, ModelsSection, PackagesSection, SafetySection, StoreHero, TrustStrip,
} from '@/components/site/storefront';
import { getSessionUser } from '@/server/auth';
import { listPublicPackages } from '@/server/services/packages';

/** Public storefront of the AIEC Lift Marketplace. Package cards come from the live published package versions. */
export default async function StorefrontPage() {
  const { t, locale } = await getT();
  const [user, packages] = await Promise.all([getSessionUser(), listPublicPackages()]);
  return (
    <>
      <SiteHeader signedIn={Boolean(user)} />
      <main id="main">
        <StoreHero t={t} />
        <TrustStrip t={t} />
        <PackagesSection t={t} locale={locale} packages={packages} />
        <HowSection t={t} />
        <CustomiseSection t={t} />
        <SafetySection t={t} />
        <ModelsSection t={t} />
        <JoinSection t={t} />
        <AreasStrip t={t} />
        <FaqSection t={t} />
        <FinalCta t={t} />
      </main>
      <SiteFooter />
    </>
  );
}
