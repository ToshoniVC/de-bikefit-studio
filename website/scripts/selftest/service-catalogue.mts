/**
 * Self-test section 14c (work block 2026-10-16): the service catalogue is the
 * admin's. On the throwaway PGlite of `cms-selftest.mts`, with real sessions in
 * the cookie jar, as a forged server-action POST would arrive:
 *
 *  1. a provider calling `createService()` directly, or the server action
 *     `createServiceAction` behind the (removed) form, is refused; no row;
 *  2. the legacy case: a service whose `created_by` is that provider (created
 *     before 16 Oct 2026, when providers could) cannot be edited, re-priced,
 *     deactivated or reactivated by them, through the repo or the actions; the
 *     row is byte-for-byte unchanged and nothing is audited;
 *  3. the provider may still subscribe and unsubscribe their own profile to
 *     an ACTIVE service, keep a subscription to a service an admin deactivated
 *     since, but never add an inactive one; another provider's profile stays
 *     out of reach;
 *  4. the admin keeps full catalogue management (create, edit, price,
 *     deactivate, reactivate), and `choice_label` (migration 0009) round-trips;
 *  0. first, migration 0009 itself: one guarded ADD COLUMN, nothing else, and
 *     re-running it twice is a no-op.
 *
 * Everything it creates is removed again (services, the second provider, the
 * audit rows it wrote are left: they are the evidence), and the admin is
 * signed in at the end so section 14 continues as before.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import type { ActionState } from '@/lib/cms/actions/state';

type Check = (label: string, condition: boolean, detail?: string) => void;

export async function serviceCatalogueSection(ctx: {
  db: CmsDatabase;
  check: Check;
  section: (title: string) => void;
  signInAs: (userId: string) => Promise<void>;
  admin: { id: string };
  provider: { id: string; userId: string };
}) {
  const { db, check, section, signInAs, admin, provider } = ctx;
  section('14c. service catalogue: admin-managed, providers only subscribe');

  const { cmsAuditLog, cmsProviderServices, cmsServices } = await import('@/db/cms-schema');
  const { CmsAuthError } = await import('@/lib/cms/auth');
  const repo = await import('@/lib/booking/repo');
  const actions = await import('@/lib/cms/actions/services');
  const { setProviderServicesAction } = await import('@/lib/cms/actions/providers');

  const refused = async (run: () => Promise<unknown>) => {
    try {
      await run();
      return false;
    } catch (error) {
      return error instanceof CmsAuthError && error.code === 'forbidden';
    }
  };
  const form = (fields: Record<string, string | string[]>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      for (const entry of Array.isArray(value) ? value : [value]) data.append(key, entry);
    }
    return data;
  };
  const IDLE: ActionState = { ok: false, message: '' };
  const FORBIDDEN = 'Je hebt geen toestemming voor deze actie.';
  const rowOf = async (id: string) =>
    (await db.select().from(cmsServices).where(eq(cmsServices.id, id)).limit(1))[0] ?? null;
  const auditCount = async (id: string) =>
    (await db.select().from(cmsAuditLog).where(eq(cmsAuditLog.entityId, id))).length;
  const subscribed = async (providerId: string) =>
    (
      await db
        .select({ serviceId: cmsProviderServices.serviceId })
        .from(cmsProviderServices)
        .where(eq(cmsProviderServices.providerId, providerId))
    ).map((row) => row.serviceId);

  // --- 0: migration 0009 ------------------------------------------------------
  const column = (
    (await db.execute(
      sql`select data_type, is_nullable, column_default from information_schema.columns
          where table_name = 'cms_services' and column_name = 'choice_label'`,
    )) as unknown as { rows: Array<Record<string, string>> }
  ).rows;
  check(
    'migration 0009: cms_services.choice_label text, not null, default empty',
    column.length === 1 &&
      column[0].data_type === 'text' &&
      column[0].is_nullable === 'NO' &&
      String(column[0].column_default).startsWith("''"),
    JSON.stringify(column),
  );
  const migrationSql = await readFile(
    resolve(process.cwd(), 'drizzle/0009_cms_service_choice_label.sql'),
    'utf8',
  );
  const code = migrationSql.replace(/^--.*$/gm, '').trim();
  check(
    'migration 0009: one guarded ADD COLUMN on cms_services, no data change, no DROP',
    /^ALTER TABLE "cms_services" ADD COLUMN IF NOT EXISTS "choice_label" text DEFAULT '' NOT NULL;$/.test(
      code,
    ),
    code,
  );
  let rerun = 'ok';
  try {
    for (let pass = 0; pass < 2; pass += 1) await db.execute(sql.raw(code));
  } catch (error) {
    rerun = error instanceof Error ? error.message : String(error);
  }
  check('migration 0009: re-running it twice is a no-op', rerun === 'ok', rerun);

  // --- set-up as admin: a legacy provider-created service, an inactive one ---
  await signInAs(admin.id);
  const legacy = await repo.createService({
    name: 'Catalogus legacy',
    slug: 'selftest-catalogus-legacy',
    durationMinutes: 45,
  });
  const retired = await repo.createService({
    name: 'Catalogus uit',
    slug: 'selftest-catalogus-uit',
    durationMinutes: 30,
  });
  if (!legacy.ok || !retired.ok) {
    check('catalogue: set-up services created', false);
    return;
  }
  // What a provider-created row from before 16 Oct 2026 looks like.
  await db
    .update(cmsServices)
    .set({ createdBy: provider.userId })
    .where(eq(cmsServices.id, legacy.data.id));
  const before = await rowOf(legacy.data.id);
  const auditsBefore = await auditCount(legacy.data.id);
  const ownBefore = await subscribed(provider.id);

  const other = await repo.createProvider({
    newUser: { email: 'catalogus-tweede@selftest.local', name: 'Tweede Aanbieder' },
  });
  check('catalogue: second provider for the scope check', other.ok);

  // --- 1 + 2: the provider, directly against the repo and the actions --------
  await signInAs(provider.userId);
  const servicesBefore = (await db.select({ id: cmsServices.id }).from(cmsServices)).length;
  check(
    'provider: repo.createService is forbidden',
    await refused(() => repo.createService({ name: 'Eigen dienst', durationMinutes: 60 })),
  );
  const created = await actions.createServiceAction(
    IDLE,
    form({ name: 'Eigen dienst', durationMinutes: '60', price: '99', showPrice: 'on' }),
  );
  check(
    'provider: createServiceAction (direct POST) is refused in Dutch',
    !created.ok && created.message === FORBIDDEN,
    created.message,
  );
  check(
    'provider: no service row was created',
    (await db.select({ id: cmsServices.id }).from(cmsServices)).length === servicesBefore,
  );

  check(
    'provider (legacy created_by): repo.updateService is forbidden',
    await refused(() => repo.updateService(legacy.data.id, { priceCents: 1, showPrice: true })),
  );
  check(
    'provider (legacy created_by): repo.deleteService is forbidden',
    await refused(() => repo.deleteService(legacy.data.id)),
  );
  const fields = {
    serviceId: legacy.data.id,
    name: 'Overgenomen',
    durationMinutes: '15',
    price: '1',
    showPrice: 'on',
    isActive: 'on',
  };
  const updated = await actions.updateServiceAction(IDLE, form(fields));
  const deactivated = await actions.deactivateServiceAction(
    IDLE,
    form({ serviceId: legacy.data.id }),
  );
  const reactivated = await actions.reactivateServiceAction(
    IDLE,
    form({ serviceId: retired.data.id }),
  );
  check(
    'provider (legacy created_by): update / deactivate / reactivate actions refused',
    [updated, deactivated, reactivated].every((r) => !r.ok && r.message === FORBIDDEN),
    [updated, deactivated, reactivated].map((r) => r.message).join(' | '),
  );
  const after = await rowOf(legacy.data.id);
  check(
    'provider (legacy created_by): the row is unchanged (name, duration, price, active)',
    JSON.stringify(after) === JSON.stringify(before),
  );
  check(
    'provider: refused attempts are not audited',
    (await auditCount(legacy.data.id)) === auditsBefore,
  );

  // --- 3: subscriptions on the own profile only, active services only --------
  await signInAs(admin.id);
  await repo.deleteService(retired.data.id); // soft: is_active = false
  await signInAs(provider.userId);

  const keep = ownBefore.map((serviceId) => ({ serviceId }));
  const joined = await repo.setProviderServices(provider.id, [
    ...keep,
    { serviceId: legacy.data.id },
  ]);
  check(
    'provider: subscribes the own profile to an active service',
    joined.ok && (await subscribed(provider.id)).includes(legacy.data.id),
  );
  const intoInactive = await repo.setProviderServices(provider.id, [
    ...keep,
    { serviceId: legacy.data.id },
    { serviceId: retired.data.id },
  ]);
  check(
    'provider: cannot subscribe to an inactive service',
    !intoInactive.ok &&
      intoInactive.message === 'Je kunt je enkel inschrijven voor actieve diensten.' &&
      !(await subscribed(provider.id)).includes(retired.data.id),
    intoInactive.ok ? '' : intoInactive.message,
  );
  const viaAction = await setProviderServicesAction(
    IDLE,
    form({
      providerId: provider.id,
      scope: 'own',
      serviceIds: [...ownBefore, legacy.data.id, retired.data.id],
    }),
  );
  check('provider: the subscription action refuses it too', !viaAction.ok, viaAction.message);

  // An admin subscribed them while it was active; deactivated since: kept, not lost.
  await signInAs(admin.id);
  await repo.updateService(retired.data.id, { isActive: true });
  await repo.setProviderServices(provider.id, [
    ...keep,
    { serviceId: legacy.data.id },
    { serviceId: retired.data.id },
  ]);
  await repo.deleteService(retired.data.id);
  await signInAs(provider.userId);
  const keptInactive = await repo.setProviderServices(provider.id, [
    ...keep,
    { serviceId: retired.data.id },
  ]);
  check(
    'provider: keeps an existing subscription to a since-deactivated service, drops another',
    keptInactive.ok &&
      (await subscribed(provider.id)).includes(retired.data.id) &&
      !(await subscribed(provider.id)).includes(legacy.data.id),
  );
  const unsubscribed = await repo.setProviderServices(provider.id, keep);
  check(
    'provider: unsubscribes the own profile',
    unsubscribed.ok &&
      JSON.stringify((await subscribed(provider.id)).sort()) ===
        JSON.stringify([...ownBefore].sort()),
  );
  if (other.ok) {
    check(
      "provider: another provider's subscriptions are forbidden",
      await refused(() =>
        repo.setProviderServices(other.data.provider.id, [{ serviceId: legacy.data.id }]),
      ),
    );
  }

  // --- 4: the admin keeps the catalogue -------------------------------------
  await signInAs(admin.id);
  const edited = await repo.updateService(legacy.data.id, {
    choiceLabel: 'Volwassene',
    priceCents: 12345,
    showPrice: false,
  });
  const reopened = await actions.reactivateServiceAction(
    IDLE,
    form({ serviceId: retired.data.id }),
  );
  const closed = await actions.deactivateServiceAction(IDLE, form({ serviceId: legacy.data.id }));
  check(
    'admin: edits, prices, deactivates and reactivates; choice_label round-trips',
    edited.ok &&
      edited.data.choiceLabel === 'Volwassene' &&
      edited.data.priceCents === 12345 &&
      reopened.ok === true &&
      closed.ok === true &&
      (await rowOf(retired.data.id))?.isActive === true &&
      (await rowOf(legacy.data.id))?.isActive === false,
    [reopened.message, closed.message].join(' | '),
  );

  // --- clean-up ---------------------------------------------------------------
  const ids = [legacy.data.id, retired.data.id];
  await db.delete(cmsProviderServices).where(inArray(cmsProviderServices.serviceId, ids));
  await db.delete(cmsServices).where(inArray(cmsServices.id, ids));
  if (other.ok) {
    const { cmsProviders, cmsUsers } = await import('@/db/cms-schema');
    await db.delete(cmsProviders).where(eq(cmsProviders.id, other.data.provider.id));
    await db
      .delete(cmsUsers)
      .where(and(eq(cmsUsers.id, other.data.provider.userId), eq(cmsUsers.role, 'provider')));
  }
}
