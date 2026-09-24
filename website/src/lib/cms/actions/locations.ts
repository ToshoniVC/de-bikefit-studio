'use server';

import { revalidatePath } from 'next/cache';
import { createLocation, deleteLocation, updateLocation } from '@/lib/booking/repo';
import type { CmsLocationKind } from '@/db/cms-schema';
import { runAction } from './run';
import { actionError, actionOk, boolField, field, nullableField, type ActionState } from './state';

/** Location server actions. `repo.ts` enforces `location.manage`. */

type LocationFormValues = {
  name: string;
  kind: CmsLocationKind;
  addressLines: string[];
  postalCode: string;
  city: string;
  country: string;
  notes: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
};

function parseLocationForm(
  form: FormData,
): { ok: true; data: LocationFormValues } | { ok: false; message: string } {
  const name = field(form, 'name');
  if (!name) return { ok: false, message: 'Vul een naam in.' };

  const kind = field(form, 'kind');
  if (kind !== 'studio' && kind !== 'customer') {
    return { ok: false, message: 'Kies een soort locatie.' };
  }

  const sortRaw = field(form, 'sortOrder');
  if (sortRaw && !/^-?\d+$/.test(sortRaw)) {
    return { ok: false, message: 'De volgorde moet een geheel getal zijn.' };
  }

  return {
    ok: true,
    data: {
      name,
      kind,
      addressLines: field(form, 'addressLines')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      postalCode: field(form, 'postalCode'),
      city: field(form, 'city'),
      country: (field(form, 'country') || 'BE').toUpperCase(),
      notes: nullableField(form, 'notes'),
      isDefault: boolField(form, 'isDefault'),
      isActive: boolField(form, 'isActive'),
      sortOrder: sortRaw ? Number(sortRaw) : 0,
    },
  };
}

function revalidateLocationViews(): void {
  revalidatePath('/admin/locations');
  revalidatePath('/admin/services');
  revalidatePath('/admin/agenda');
  revalidatePath('/admin/providers', 'layout');
}

export async function createLocationAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const parsed = parseLocationForm(form);
    if (!parsed.ok) return actionError(parsed.message);

    const result = await createLocation(parsed.data);
    if (!result.ok) return actionError(result.message);

    revalidateLocationViews();
    return actionOk(`Locatie “${result.data.name}” aangemaakt.`);
  });
}

export async function updateLocationAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const locationId = field(form, 'locationId');
    if (!locationId) return actionError('Onbekende locatie.');

    const parsed = parseLocationForm(form);
    if (!parsed.ok) return actionError(parsed.message);

    const result = await updateLocation(locationId, parsed.data);
    if (!result.ok) return actionError(result.message);

    revalidateLocationViews();
    return actionOk('Locatie opgeslagen.');
  });
}

/** Soft delete via `is_active`; bookings keep pointing at the row. */
export async function deactivateLocationAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const locationId = field(form, 'locationId');
    if (!locationId) return actionError('Onbekende locatie.');

    const result = await deleteLocation(locationId);
    if (!result.ok) return actionError(result.message);

    revalidateLocationViews();
    return actionOk('Locatie gedeactiveerd.');
  });
}

export async function reactivateLocationAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const locationId = field(form, 'locationId');
    if (!locationId) return actionError('Onbekende locatie.');

    const result = await updateLocation(locationId, { isActive: true });
    if (!result.ok) return actionError(result.message);

    revalidateLocationViews();
    return actionOk('Locatie opnieuw actief.');
  });
}
