'use server';

import { revalidatePath } from 'next/cache';
import { slugify } from '@/lib/booking/format';
import { createService, deleteService, updateService } from '@/lib/booking/repo';
import { runAction } from './run';
import { actionError, actionOk, boolField, field, type ActionState } from './state';

/**
 * Service server actions. `repo.ts` enforces `service.create` (providers may
 * create) and `service.manage` (edit / deactivate any service).
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function intIn(raw: string, min: number, max: number): number | null {
  if (!/^-?\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

/** "149,50" / "149.50" / "150" → cents; `undefined` when invalid. */
function euroToCents(raw: string): number | null | undefined {
  if (!raw) return null;
  const normalized = raw.replace(/\s|€/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return undefined;
  return Math.round(Number(normalized) * 100);
}

type ServiceFormValues = {
  name: string;
  slug: string;
  description: string;
  durationMinutes: number;
  bufferAfterMinutes: number | null;
  priceCents: number | null;
  showPrice: boolean;
  locationId: string | null;
  requiresGuardian: boolean;
  isActive: boolean;
  sortOrder: number;
  color: string | null;
};

function parseServiceForm(
  form: FormData,
): { ok: true; data: ServiceFormValues } | { ok: false; message: string } {
  const name = field(form, 'name');
  if (!name) return { ok: false, message: 'Vul een naam in.' };

  const slug = field(form, 'slug') ? slugify(field(form, 'slug')) : slugify(name);
  if (!slug || !SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      message: 'De slug mag enkel kleine letters, cijfers en koppeltekens bevatten.',
    };
  }

  const durationMinutes = intIn(field(form, 'durationMinutes'), 5, 720);
  if (durationMinutes === null) {
    return { ok: false, message: 'De duur moet een geheel aantal minuten tussen 5 en 720 zijn.' };
  }

  const bufferRaw = field(form, 'bufferAfterMinutes');
  const bufferAfterMinutes = bufferRaw ? intIn(bufferRaw, 0, 240) : null;
  if (bufferRaw && bufferAfterMinutes === null) {
    return { ok: false, message: 'De buffer moet tussen 0 en 240 minuten liggen.' };
  }

  const priceCents = euroToCents(field(form, 'price'));
  if (priceCents === undefined) {
    return { ok: false, message: 'Geef de prijs in euro, bv. 150 of 149,50.' };
  }

  const sortRaw = field(form, 'sortOrder');
  const sortOrder = sortRaw ? intIn(sortRaw, -10000, 10000) : 0;
  if (sortOrder === null) return { ok: false, message: 'De volgorde moet een geheel getal zijn.' };

  const color = field(form, 'color');
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return { ok: false, message: 'De kleur moet een hex-code zijn, bv. #2f6f5e.' };
  }

  return {
    ok: true,
    data: {
      name,
      slug,
      description: field(form, 'description'),
      durationMinutes,
      bufferAfterMinutes,
      priceCents,
      showPrice: boolField(form, 'showPrice'),
      locationId: field(form, 'locationId') || null,
      requiresGuardian: boolField(form, 'requiresGuardian'),
      isActive: boolField(form, 'isActive'),
      sortOrder,
      color: color ? color.toLowerCase() : null,
    },
  };
}

function revalidateServiceViews(): void {
  revalidatePath('/admin/services');
  revalidatePath('/admin/agenda');
  revalidatePath('/admin/providers', 'layout');
}

export async function createServiceAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const parsed = parseServiceForm(form);
    if (!parsed.ok) return actionError(parsed.message);

    const result = await createService(parsed.data);
    if (!result.ok) return actionError(result.message);

    revalidateServiceViews();
    return actionOk(`Dienst “${result.data.name}” aangemaakt.`);
  });
}

export async function updateServiceAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const serviceId = field(form, 'serviceId');
    if (!serviceId) return actionError('Onbekende dienst.');

    const parsed = parseServiceForm(form);
    if (!parsed.ok) return actionError(parsed.message);

    const result = await updateService(serviceId, parsed.data);
    if (!result.ok) return actionError(result.message);

    revalidateServiceViews();
    return actionOk('Dienst opgeslagen.');
  });
}

/** Soft delete: the service stays for existing bookings but is no longer bookable. */
export async function deactivateServiceAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const serviceId = field(form, 'serviceId');
    if (!serviceId) return actionError('Onbekende dienst.');

    const result = await deleteService(serviceId);
    if (!result.ok) return actionError(result.message);

    revalidateServiceViews();
    return actionOk('Dienst gedeactiveerd.');
  });
}

export async function reactivateServiceAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const serviceId = field(form, 'serviceId');
    if (!serviceId) return actionError('Onbekende dienst.');

    const result = await updateService(serviceId, { isActive: true });
    if (!result.ok) return actionError(result.message);

    revalidateServiceViews();
    return actionOk('Dienst opnieuw actief.');
  });
}
