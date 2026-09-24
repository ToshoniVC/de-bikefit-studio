'use server';

import { revalidatePath } from 'next/cache';
import {
  createProvider,
  disconnectGoogle,
  setProviderServices,
  updateProvider,
} from '@/lib/booking/repo';
import { isValidTimeZone } from '@/lib/booking/time';
import { runAction } from './run';
import { actionError, actionOk, boolField, field, nullableField, type ActionState } from './state';

/**
 * Provider server actions. `repo.ts` enforces `provider.manage` for any
 * provider and `provider.self` / `service.subscribe.own` for the caller's own
 * provider row, so the `providerId` a form sends is never trusted on its own.
 */

function revalidateProviderViews(providerId?: string): void {
  revalidatePath('/admin/providers');
  if (providerId) revalidatePath(`/admin/providers/${providerId}`);
  revalidatePath('/admin/agenda');
}

export async function createProviderAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const mode = field(form, 'mode');
    const displayName = field(form, 'displayName') || undefined;
    const defaultLocationId = field(form, 'defaultLocationId') || null;

    let result;
    if (mode === 'existing') {
      const userId = field(form, 'userId');
      if (!userId) return actionError('Kies een gebruiker.');
      result = await createProvider({ userId, displayName, defaultLocationId });
    } else {
      const email = field(form, 'email');
      const name = field(form, 'name');
      if (!email || !email.includes('@')) return actionError('Vul een geldig e-mailadres in.');
      if (!name) return actionError('Vul een naam in.');
      result = await createProvider({ newUser: { email, name }, displayName, defaultLocationId });
    }
    if (!result.ok) return actionError(result.message);

    revalidateProviderViews();
    revalidatePath('/admin/users');
    const { temporaryPassword } = result.data;
    return actionOk(
      temporaryPassword
        ? 'Aanbieder aangemaakt. Geef dit tijdelijke wachtwoord één keer door; het moet bij de eerste aanmelding gewijzigd worden.'
        : 'Aanbieder aangemaakt.',
      temporaryPassword ? { temporaryPassword } : undefined,
    );
  });
}

export async function updateProviderAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const providerId = field(form, 'providerId');
    if (!providerId) return actionError('Onbekende aanbieder.');

    const displayName = field(form, 'displayName');
    if (!displayName) return actionError('Vul een weergavenaam in.');

    const email = nullableField(form, 'email');
    if (email && !email.includes('@')) return actionError('Vul een geldig e-mailadres in.');

    const timezone = field(form, 'timezone') || 'Europe/Brussels';
    if (!isValidTimeZone(timezone)) {
      return actionError('Tijdzone: gebruik een IANA-naam zoals Europe/Brussels.');
    }

    const sortRaw = field(form, 'sortOrder');
    if (sortRaw && !/^-?\d+$/.test(sortRaw)) {
      return actionError('De volgorde moet een geheel getal zijn.');
    }

    const result = await updateProvider(providerId, {
      displayName,
      bio: field(form, 'bio'),
      phone: nullableField(form, 'phone'),
      email,
      timezone,
      defaultLocationId: field(form, 'defaultLocationId') || null,
      isActive: boolField(form, 'isActive'),
      ...(sortRaw ? { sortOrder: Number(sortRaw) } : {}),
    });
    if (!result.ok) return actionError(result.message);

    revalidateProviderViews(providerId);
    return actionOk('Profiel opgeslagen.');
  });
}

/** Checkbox per service (`serviceIds`) + optional `location:<serviceId>` override. */
export async function setProviderServicesAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const providerId = field(form, 'providerId');
    if (!providerId) return actionError('Onbekende aanbieder.');

    const serviceIds = [
      ...new Set(
        form
          .getAll('serviceIds')
          .filter((value): value is string => typeof value === 'string' && value !== ''),
      ),
    ];
    const rows = serviceIds.map((serviceId) => ({
      serviceId,
      locationId: field(form, `location:${serviceId}`) || null,
    }));

    const result = await setProviderServices(providerId, rows);
    if (!result.ok) return actionError(result.message);

    revalidateProviderViews(providerId);
    revalidatePath('/admin/services');
    return actionOk(
      rows.length === 0
        ? 'Geen diensten meer geselecteerd.'
        : `${rows.length} dienst(en) opgeslagen.`,
    );
  });
}

export async function disconnectGoogleAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const providerId = field(form, 'providerId');
    if (!providerId) return actionError('Onbekende aanbieder.');

    const result = await disconnectGoogle(providerId);
    if (!result.ok) return actionError(result.message);

    revalidateProviderViews(providerId);
    return actionOk('Google Agenda ontkoppeld.');
  });
}
