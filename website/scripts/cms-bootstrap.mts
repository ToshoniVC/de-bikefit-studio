/**
 * Idempotent CMS bootstrap.
 *
 *   CMS_BOOTSTRAP_PASSWORD='…' npm run cms:bootstrap
 *
 * Creates, if and only if they are missing:
 *   1. the first admin, contact@toshoni.be, with must_change_password = true
 *   2. default `nl` site settings (name, tagline, contact, SEO, organisation,
 *      an EMPTY GA4 slot)
 *   3. empty `main` and `footer` navigation menus for `nl`
 *
 * Running it twice changes nothing and exits 0. It never overwrites an
 * existing password, existing settings or an existing menu.
 */
import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';

config({ path: '.env.local' });

import { getCmsDb, cmsDriver } from '@/db/cms';
import { cmsNavigation, cmsSiteSettings, cmsUsers, DEFAULT_LOCALE } from '@/db/cms-schema';
import { hashPassword, validatePasswordStrength } from '@/lib/cms/password';
import { NAVIGATION_KEYS, siteSettingSchemas } from '@/lib/cms/blocks';

const ADMIN_EMAIL = 'contact@toshoni.be';
const ADMIN_NAME = 'Toshoni';

/** Seed values for `cms_site_settings`, all facts taken from the brand/prototype. */
const DEFAULT_SETTINGS = {
  site: {
    name: 'De Bikefit Studio',
    tagline: 'Pijnvrij fietsen begint hier',
    strapline: 'Professionele bikefit · Ninove',
    mission:
      'Iedereen verdient het om te genieten van alles wat een fiets te bieden heeft. Ons werk is ervoor te zorgen dat jouw fiets je dat ook toelaat.',
    logoMediaId: null,
  },
  contact: {
    phoneLabel: '0473 95 26 33',
    phoneHref: 'tel:+32473952633',
    email: '',
    addressLines: [],
    postalCode: '',
    city: 'Ninove',
    country: 'BE',
    hours: 'Op afspraak',
    website: 'www.debikefitstudio.be',
  },
  seo: {
    defaultMetaTitle: 'De Bikefit Studio — professionele bikefit in Ninove',
    titleTemplate: '%s · De Bikefit Studio',
    defaultMetaDescription:
      'Fiets met comfort. Een bikefit lijnt de fiets uit op jou — niet omgekeerd — zodat elke rit beter voelt en je langer gezond blijft op de fiets.',
    defaultOgImageMediaId: null,
    // Staging must stay out of search results until launch.
    allowIndexing: false,
  },
  organization: {
    type: 'LocalBusiness',
    legalName: 'De Bikefit Studio',
    vatNumber: '',
    sameAs: [],
    priceRange: '',
    areaServed: ['Ninove', 'Oost-Vlaanderen'],
    latitude: null,
    longitude: null,
  },
  analytics: {
    // Intentionally empty: no analytics script and no cookie ship by default.
    ga4MeasurementId: '',
    enabled: false,
  },
} as const;

async function main() {
  const password = process.env.CMS_BOOTSTRAP_PASSWORD;
  if (!password) {
    console.error('✗ CMS_BOOTSTRAP_PASSWORD is not set.');
    console.error('');
    console.error('  Set it for this one command only, e.g.:');
    console.error("    CMS_BOOTSTRAP_PASSWORD='<a strong password>' npm run cms:bootstrap");
    console.error('');
    console.error('  Do not add it to .env.local or to any Vercel environment.');
    process.exit(1);
  }

  const weak = validatePasswordStrength(password);
  if (weak) {
    console.error(`✗ CMS_BOOTSTRAP_PASSWORD rejected: ${weak}`);
    process.exit(1);
  }

  console.log(`→ driver: ${cmsDriver()}`);
  const db = await getCmsDb();

  // 1. First admin -----------------------------------------------------------
  const [existingAdmin] = await db
    .select({ id: cmsUsers.id, role: cmsUsers.role })
    .from(cmsUsers)
    .where(eq(cmsUsers.email, ADMIN_EMAIL))
    .limit(1);

  if (existingAdmin) {
    console.log(`= admin ${ADMIN_EMAIL} already exists (${existingAdmin.role}) — left untouched`);
  } else {
    const [created] = await db
      .insert(cmsUsers)
      .values({
        email: ADMIN_EMAIL,
        name: ADMIN_NAME,
        role: 'admin',
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        isActive: true,
      })
      .returning({ id: cmsUsers.id });
    console.log(`+ admin ${ADMIN_EMAIL} created (id ${created.id}, must change password)`);
  }

  // 2. Site settings ---------------------------------------------------------
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const [existing] = await db
      .select({ key: cmsSiteSettings.key })
      .from(cmsSiteSettings)
      .where(and(eq(cmsSiteSettings.locale, DEFAULT_LOCALE), eq(cmsSiteSettings.key, key)))
      .limit(1);

    if (existing) {
      console.log(`= setting ${DEFAULT_LOCALE}/${key} already set — left untouched`);
      continue;
    }

    const schema = siteSettingSchemas[key as keyof typeof siteSettingSchemas];
    await db
      .insert(cmsSiteSettings)
      .values({ locale: DEFAULT_LOCALE, key, value: schema.parse(value) });
    console.log(`+ setting ${DEFAULT_LOCALE}/${key} created`);
  }

  // 3. Navigation ------------------------------------------------------------
  for (const menuKey of NAVIGATION_KEYS) {
    const [existing] = await db
      .select({ id: cmsNavigation.id })
      .from(cmsNavigation)
      .where(and(eq(cmsNavigation.locale, DEFAULT_LOCALE), eq(cmsNavigation.menuKey, menuKey)))
      .limit(1);

    if (existing) {
      console.log(`= menu ${DEFAULT_LOCALE}/${menuKey} already exists — left untouched`);
      continue;
    }

    await db.insert(cmsNavigation).values({ locale: DEFAULT_LOCALE, menuKey, items: [] });
    console.log(`+ menu ${DEFAULT_LOCALE}/${menuKey} created (empty)`);
  }

  console.log('');
  console.log('✓ bootstrap complete');
  console.log(`  Sign in at /admin/login as ${ADMIN_EMAIL} — you will be asked to`);
  console.log('  change the password immediately.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ bootstrap failed');
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
