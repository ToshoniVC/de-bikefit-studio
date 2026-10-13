/**
 * Self-test section 5b: the forced password change, enforced server-side by
 * the auth guard (`src/lib/cms/guard.ts`), on the throwaway PGlite of
 * `cms-selftest.mts`. It runs on the self-test's own admin, which section 4
 * creates the way `cms:bootstrap` does: with a temporary password.
 *
 * 1. the session is valid (`getCurrentCmsUser()` resolves it), yet
 *    `requireCmsUser()`, `requirePermission()`, the content repo (read and
 *    write), user management and the booking repo all throw
 *    `CmsAuthError('password_change_required')`, and nothing is written;
 * 2. the CLI actor lookup (`scripts/lib/cms-actor.mts`) refuses that admin and
 *    says why;
 * 3. the exceptions work: the `allowMustChangePassword` path and `logout()`;
 * 4. `changePassword()` refuses a wrong current password (flag stays set),
 *    then succeeds: flag cleared, old session revoked, fresh cookie issued,
 *    and the same calls pass. Sections 14–16 therefore act as an admin who
 *    chose their own password (and, after section 5c, enrolled MFA).
 *
 * The sessions here are created with `mfaVerified` on purpose: this section
 * isolates the password rule. The MFA rule, and the real sign-in flow in which
 * an admin never gets a session before the second step, are section 5c
 * (`./mfa.mts`).
 *
 * `changeTemporaryPassword()` repeats refuse → change → pass for section 14's
 * new provider. Imported lazily by `cms-selftest.mts` after its
 * request-context stubs.
 */
import { eq } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { findActingAdmin } from '../lib/cms-actor.mjs';

type Check = (label: string, condition: boolean, detail?: string) => void;
type Call = [label: string, call: () => Promise<unknown>];

export const ADMIN_NEW_PASSWORD = 'Kettingblad-2026-Eigen';
const GATE_NAME = 'selftest-tijdelijk-wachtwoord';
const GATE_EMAIL = 'tijdelijk@selftest.local';

/** `'ok'`, the `CmsAuthError` code the call failed with, or `other: …`. */
async function outcome(call: () => Promise<unknown>): Promise<string> {
  const { CmsAuthError } = await import('@/lib/cms/auth');
  try {
    await call();
    return 'ok';
  } catch (error) {
    if (error instanceof CmsAuthError) return error.code;
    return `other: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function passwordGateSection(ctx: {
  db: CmsDatabase;
  admin: { id: string; email: string };
  /** The admin's current (temporary) password. */
  currentPassword: string;
  check: Check;
  section: (title: string) => void;
  cookieJar: Map<string, string>;
}) {
  const { db, admin, check, section, cookieJar } = ctx;
  section('5b. forced password change (server-side gate)');

  const auth = await import('@/lib/cms/auth');
  const users = await import('@/lib/cms/users');
  const cmsRepo = await import('@/lib/cms/repo');
  const bookingRepo = await import('@/lib/booking/repo');
  const { createSession, resolveSession, revokeSession } = await import('@/lib/cms/session');
  const orm = await import('drizzle-orm');
  const schema = await import('@/db/cms-schema');
  const { cmsLocations, cmsPages, cmsUsers } = schema;

  const flagged = async () => {
    const [row] = await db
      .select({ flag: cmsUsers.mustChangePassword })
      .from(cmsUsers)
      .where(eq(cmsUsers.id, admin.id))
      .limit(1);
    return row?.flag;
  };
  check(
    'the admin starts with a temporary password, as cms:bootstrap creates it',
    (await flagged()) === true,
  );

  // --- 1. A valid session that may do nothing --------------------------------
  const first = await createSession(
    db,
    admin.id,
    { userAgent: 'selftest-password-gate' },
    { mfaVerified: true },
  );
  cookieJar.set('cms_session', first.token);
  const who = await auth.getCurrentCmsUser();
  check(
    'the session itself is valid (getCurrentCmsUser resolves it)',
    who?.id === admin.id && who.mustChangePassword === true,
  );

  const refused: Call[] = [
    ['requireCmsUser()', () => auth.requireCmsUser()],
    ["requireCmsUser('admin')", () => auth.requireCmsUser('admin')],
    ["requirePermission('page.read')", () => auth.requirePermission('page.read')],
    ['content repo listPages()', () => cmsRepo.listPages()],
    ['content repo createPage()', () => cmsRepo.createPage({ slug: GATE_NAME, title: 'Test' })],
    ['users listCmsUsers()', () => users.listCmsUsers()],
    [
      'users createUser()',
      () => users.createUser({ email: GATE_EMAIL, name: 'Tijdelijk', role: 'admin' }),
    ],
    ['booking repo listBookings()', () => bookingRepo.listBookings()],
    [
      'booking repo createLocation()',
      () => bookingRepo.createLocation({ name: GATE_NAME, kind: 'studio' }),
    ],
  ];
  for (const [label, call] of refused) {
    const result = await outcome(call);
    check(`refused: ${label}`, result === 'password_change_required', result);
  }
  const [page] = await db
    .select({ id: cmsPages.id })
    .from(cmsPages)
    .where(eq(cmsPages.slug, GATE_NAME));
  const [user] = await db
    .select({ id: cmsUsers.id })
    .from(cmsUsers)
    .where(eq(cmsUsers.email, GATE_EMAIL));
  const [location] = await db
    .select({ id: cmsLocations.id })
    .from(cmsLocations)
    .where(eq(cmsLocations.name, GATE_NAME));
  check('nothing was written (no page, user or location)', !page && !user && !location);

  // --- 2. The CLIs will not act as this admin --------------------------------
  let actorError = '';
  try {
    await findActingAdmin({ db, orm, schema });
  } catch (error) {
    actorError = error instanceof Error ? error.message : String(error);
  }
  check(
    'CLI actor lookup refuses a temporary-password admin and says why',
    actorError.includes('temporary password') && actorError.includes(admin.email),
    actorError,
  );

  // --- 3. The exceptions -------------------------------------------------------
  const allowed = await outcome(() =>
    auth.requireCmsUser(undefined, { allowMustChangePassword: true }),
  );
  check('allowed: requireCmsUser(…, { allowMustChangePassword: true })', allowed === 'ok', allowed);
  await auth.logout();
  check(
    'allowed: logout() revokes the temporary-password session',
    (await resolveSession(db, first.token)) === null,
  );

  // --- 4. The forced change itself ---------------------------------------------
  // As right after a full sign-in (password + code): an admin's own password
  // change also needs a recent re-authentication (section 5e).
  const second = await createSession(
    db,
    admin.id,
    { userAgent: 'selftest-password-gate' },
    { mfaVerified: true, reauthenticated: true },
  );
  cookieJar.set('cms_session', second.token);
  const wrong = await auth.changePassword({
    currentPassword: 'Verkeerd-Wachtwoord-2026',
    newPassword: ADMIN_NEW_PASSWORD,
  });
  check(
    'changePassword(): a wrong current password is refused, the flag stays set',
    !wrong.ok && wrong.error === 'invalid_credentials' && (await flagged()) === true,
    wrong.ok ? 'accepted!' : wrong.message,
  );
  const changed = await auth.changePassword({
    currentPassword: ctx.currentPassword,
    newPassword: ADMIN_NEW_PASSWORD,
  });
  check(
    'allowed: changePassword() for the temporary-password session',
    changed.ok,
    changed.ok ? '' : changed.message,
  );
  check('db: must_change_password cleared', (await flagged()) === false);
  const fresh = cookieJar.get('cms_session') ?? '';
  const freshSession = fresh ? await resolveSession(db, fresh) : null;
  check(
    'old session revoked, fresh cookie issued for the same user',
    (await resolveSession(db, second.token)) === null &&
      fresh !== second.token &&
      freshSession?.user.id === admin.id,
  );

  const passing: Call[] = [
    ["requireCmsUser('admin')", () => auth.requireCmsUser('admin')],
    ['content repo listPages()', () => cmsRepo.listPages()],
    ['booking repo listBookings()', () => bookingRepo.listBookings()],
  ];
  for (const [label, call] of passing) {
    const result = await outcome(call);
    check(`after the change: ${label} passes`, result === 'ok', result);
  }
  let mfaError = '';
  try {
    await findActingAdmin({ db, orm, schema });
  } catch (error) {
    mfaError = error instanceof Error ? error.message : String(error);
  }
  check(
    'CLI actor lookup still refuses this admin until two-step verification is set up (5c)',
    mfaError.includes('two-step verification') && mfaError.includes(admin.email),
    mfaError,
  );
  check(
    'changePassword() kept the MFA state of the session it replaced',
    freshSession?.mfaVerified === true,
  );

  if (fresh) await revokeSession(db, fresh);
  cookieJar.clear();
}

/**
 * For the user signed in through the cookie jar, whose password is still
 * temporary: `probe` is refused with `password_change_required`,
 * `changePassword()` (the allowed path) succeeds, and `probe` then passes.
 */
export async function changeTemporaryPassword(ctx: {
  label: string;
  currentPassword: string;
  newPassword: string;
  probe: () => Promise<unknown>;
  check: Check;
}): Promise<void> {
  const { label, check } = ctx;
  const { changePassword } = await import('@/lib/cms/auth');

  const before = await outcome(ctx.probe);
  check(
    `${label}: temporary-password session refused (password_change_required)`,
    before === 'password_change_required',
    before,
  );
  const changed = await changePassword({
    currentPassword: ctx.currentPassword,
    newPassword: ctx.newPassword,
  });
  check(`${label}: changePassword() allowed`, changed.ok, changed.ok ? '' : changed.message);
  const after = await outcome(ctx.probe);
  check(`${label}: the same call passes after the change`, after === 'ok', after);
}
