/**
 * Seeds the first booking provider (staging / local). Idempotent.
 *
 *   npm run cms:seed-booking
 *   PROVIDER_EMAIL=someone@example.com PROVIDER_NAME='Someone' npm run cms:seed-booking
 *
 * Creates, if and only if they are missing:
 *   1. the provider user (default toshoni@gmail.com, display name "Toshoni"),
 *      role `provider`, must_change_password = true — the temporary password is
 *      printed ONCE, here, and never stored in plain text;
 *   2. the provider profile (`cms_providers`) at the default location;
 *   3. business hours Mon–Fri 09:00–18:00 and Sat 09:00–13:00 (only when the
 *      provider has no hours yet);
 *   4. subscriptions to the five bootstrap services (existing ones are kept).
 *
 * Never touches Google: the provider connects their own calendar from
 * /admin/agenda. Run `npm run cms:bootstrap` first (it creates the services).
 * An existing user keeps their role and password.
 */
import { config } from 'dotenv';
import { and, eq, inArray } from 'drizzle-orm';

config({ path: '.env.local' });

import { getCmsDb, cmsDriver } from '@/db/cms';
import {
  cmsBusinessHours,
  cmsLocations,
  cmsProviderServices,
  cmsProviders,
  cmsServices,
  cmsUsers,
  DEFAULT_LOCALE,
} from '@/db/cms-schema';
import { generateTemporaryPassword, hashPassword } from '@/lib/cms/password';
import { DEFAULT_PROVIDER_HOURS, DEFAULT_SERVICES } from '@/lib/booking/defaults';

const PROVIDER_EMAIL = (process.env.PROVIDER_EMAIL ?? 'toshoni@gmail.com').trim().toLowerCase();
const PROVIDER_NAME = (process.env.PROVIDER_NAME ?? 'Toshoni').trim();

async function main() {
  console.log(`→ driver: ${cmsDriver()}`);
  const db = await getCmsDb();

  // 1. User ------------------------------------------------------------------
  let [user] = await db
    .select({ id: cmsUsers.id, role: cmsUsers.role, name: cmsUsers.name })
    .from(cmsUsers)
    .where(eq(cmsUsers.email, PROVIDER_EMAIL))
    .limit(1);

  let temporaryPassword: string | null = null;
  if (user) {
    console.log(
      `= user ${PROVIDER_EMAIL} already exists (${user.role}) — role and password left untouched`,
    );
  } else {
    temporaryPassword = generateTemporaryPassword();
    [user] = await db
      .insert(cmsUsers)
      .values({
        email: PROVIDER_EMAIL,
        name: PROVIDER_NAME,
        role: 'provider',
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        isActive: true,
      })
      .returning({ id: cmsUsers.id, role: cmsUsers.role, name: cmsUsers.name });
    console.log(`+ user ${PROVIDER_EMAIL} created (role provider, must change password)`);
  }

  // 2. Profile ---------------------------------------------------------------
  const [defaultLocation] = await db
    .select({ id: cmsLocations.id })
    .from(cmsLocations)
    .where(and(eq(cmsLocations.isDefault, true), eq(cmsLocations.isActive, true)))
    .limit(1);

  let [provider] = await db
    .select({ id: cmsProviders.id })
    .from(cmsProviders)
    .where(eq(cmsProviders.userId, user.id))
    .limit(1);
  if (provider) {
    console.log(`= provider profile for ${PROVIDER_EMAIL} already exists — left untouched`);
  } else {
    [provider] = await db
      .insert(cmsProviders)
      .values({
        userId: user.id,
        displayName: PROVIDER_NAME,
        timezone: 'Europe/Brussels',
        defaultLocationId: defaultLocation?.id ?? null,
        isActive: true,
      })
      .returning({ id: cmsProviders.id });
    console.log(`+ provider profile “${PROVIDER_NAME}” created`);
  }

  // 3. Hours -----------------------------------------------------------------
  const existingHours = await db
    .select({ id: cmsBusinessHours.id })
    .from(cmsBusinessHours)
    .where(eq(cmsBusinessHours.providerId, provider.id));
  if (existingHours.length > 0) {
    console.log(`= business hours already set (${existingHours.length} ranges) — left untouched`);
  } else {
    await db
      .insert(cmsBusinessHours)
      .values(DEFAULT_PROVIDER_HOURS.map((row) => ({ ...row, providerId: provider.id })));
    console.log('+ business hours: ma–vr 09:00–18:00, za 09:00–13:00');
  }

  // 4. Services --------------------------------------------------------------
  const services = await db
    .select({ id: cmsServices.id, slug: cmsServices.slug })
    .from(cmsServices)
    .where(
      and(
        eq(cmsServices.locale, DEFAULT_LOCALE),
        inArray(
          cmsServices.slug,
          DEFAULT_SERVICES.map((service) => service.slug),
        ),
      ),
    );
  if (services.length < DEFAULT_SERVICES.length) {
    console.log(
      `! only ${services.length} of ${DEFAULT_SERVICES.length} services exist — run \`npm run cms:bootstrap\` first`,
    );
  }
  for (const service of services) {
    const inserted = await db
      .insert(cmsProviderServices)
      .values({ providerId: provider.id, serviceId: service.id })
      .onConflictDoNothing()
      .returning({ serviceId: cmsProviderServices.serviceId });
    console.log(
      `${inserted.length ? '+' : '='} service ${service.slug}${inserted.length ? ' subscribed' : ' already subscribed'}`,
    );
  }

  console.log('');
  console.log('✓ booking seed complete');
  if (temporaryPassword) {
    console.log('');
    console.log(`  Temporary password for ${PROVIDER_EMAIL} (shown once, change on first login):`);
    console.log(`    ${temporaryPassword}`);
  }
  console.log('  Google Calendar is connected by the provider under /admin/agenda.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ booking seed failed');
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
