'use server';

import { revalidatePath } from 'next/cache';
import type { CmsRole } from '@/db/cms-schema';
import { requireCmsUser } from '@/lib/cms/auth';
import { roleRequiresMfa } from '@/lib/cms/guard';
import { ensureProviderProfile } from '@/lib/booking/repo-provider-profile';
import { createUser, resetUserPassword, setUserActive, setUserRole } from '@/lib/cms/users';
import { runAction } from './run';
import { actionError, actionOk, field, type ActionState } from './state';

/**
 * User management — admin only. `auth.ts` re-checks the role on every call and
 * already refuses self-demotion and self-deactivation; the extra guards here
 * only produce a nicer message.
 *
 * Temporary passwords are returned once, in `payload`, so the admin can hand
 * them over. Hashes never leave the database layer.
 *
 * A user with the role Aanbieder is a provider: the profile (`cms_providers`)
 * is created with the account and on a role change to Aanbieder, so Mijn
 * agenda works at the first sign-in and nothing has to be linked by hand.
 */

/** The profile that makes an Aanbieder account bookable; a failure is reported, never hidden. */
async function profileNotice(userId: string): Promise<string> {
  const profile = await ensureProviderProfile(userId);
  if (!profile.ok) return ` Het aanbiedersprofiel kon niet aangemaakt worden: ${profile.message}`;
  return profile.data.created ? ' Het aanbiedersprofiel is meteen aangemaakt.' : '';
}

/** For roles that require it (admins, providers): what the admin should tell the user. */
const MFA_NOTICE =
  ' Voor deze rol is tweestapsverificatie verplicht: bij de eerste aanmelding stelt de gebruiker een authenticator-app in.';

function roleFrom(form: FormData): CmsRole | null {
  const role = field(form, 'role');
  return role === 'admin' || role === 'editor' || role === 'provider' ? role : null;
}

export async function createUserAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const email = field(form, 'email');
    const name = field(form, 'name');
    const role = roleFrom(form);

    if (!email || !email.includes('@')) return actionError('Vul een geldig e-mailadres in.');
    if (!name) return actionError('Vul een naam in.');
    if (!role) return actionError('Kies een rol.');

    const password = String(form.get('password') ?? '').trim();
    const result = await createUser({
      email,
      name,
      role,
      password: password === '' ? undefined : password,
    });
    if (!result.ok) return actionError(result.message);

    const profile = role === 'provider' ? await profileNotice(result.data.user.id) : '';
    revalidatePath('/admin/users');
    revalidatePath('/admin/providers');
    return actionOk(
      `Gebruiker ${result.data.user.email} aangemaakt. Het wachtwoord moet bij de eerste aanmelding gewijzigd worden.${roleRequiresMfa(role) ? MFA_NOTICE : ''}${profile}`,
      result.data.temporaryPassword
        ? { temporaryPassword: result.data.temporaryPassword }
        : undefined,
    );
  });
}

export async function setUserRoleAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireCmsUser('admin');
    const userId = field(form, 'userId');
    const role = roleFrom(form);
    if (!userId) return actionError('Onbekende gebruiker.');
    if (!role) return actionError('Kies een rol.');
    if (userId === actor.id && role !== 'admin') {
      return actionError('Je kan je eigen beheerdersrol niet afnemen.');
    }

    const result = await setUserRole(userId, role);
    if (!result.ok) return actionError(result.message);

    const profile = role === 'provider' ? await profileNotice(userId) : '';
    revalidatePath('/admin/users');
    revalidatePath('/admin/providers');
    // A session without the second step is refused from the next request on;
    // the user signs in again (and enrols if no authenticator exists yet).
    return actionOk(
      (roleRequiresMfa(role)
        ? 'Rol aangepast. Voor deze rol is tweestapsverificatie verplicht: zonder die bevestiging moet de gebruiker zich opnieuw aanmelden.'
        : 'Rol aangepast.') + profile,
    );
  });
}

export async function setUserActiveAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireCmsUser('admin');
    const userId = field(form, 'userId');
    const isActive = field(form, 'isActive') === 'true';
    if (!userId) return actionError('Onbekende gebruiker.');
    if (userId === actor.id && !isActive) {
      return actionError('Je kan je eigen account niet deactiveren.');
    }

    const result = await setUserActive(userId, isActive);
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/users');
    return actionOk(isActive ? 'Account geactiveerd.' : 'Account gedeactiveerd.');
  });
}

export async function resetUserPasswordAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const userId = field(form, 'userId');
    if (!userId) return actionError('Onbekende gebruiker.');

    const result = await resetUserPassword(userId);
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/users');
    return actionOk('Tijdelijk wachtwoord aangemaakt. Geef het één keer door.', {
      temporaryPassword: result.data,
    });
  });
}
