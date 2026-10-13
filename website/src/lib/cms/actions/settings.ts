'use server';

import { revalidatePath } from 'next/cache';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { isValidTimeZone } from '@/lib/booking/time';
import { isSiteSettingKey, type SiteSettingKey } from '@/lib/cms/blocks';
import { updateSiteSetting } from '@/lib/cms/repo';
import { isUnsafeUrl } from './sanitize';
import { runAction } from './run';
import { actionError, actionOk, boolField, field, type ActionState } from './state';

/** Site-settings server actions — admin only (`settings.update` in `repo.ts`). */

function lines(form: FormData, name: string): string[] {
  return field(form, name)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function numberOrNull(form: FormData, name: string): number | null {
  const raw = field(form, name).replace(',', '.');
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Whole number from a form field, or `undefined` when empty or not a number so
 * the schema default applies. Out-of-range values are left for zod to refuse.
 */
function intOrUndefined(form: FormData, name: string): number | undefined {
  const raw = field(form, name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : undefined;
}

function valueFor(key: SiteSettingKey, form: FormData): unknown {
  switch (key) {
    case 'site':
      return {
        name: field(form, 'name'),
        tagline: field(form, 'tagline'),
        strapline: field(form, 'strapline'),
        mission: field(form, 'mission'),
        logoMediaId: field(form, 'logoMediaId') || null,
      };
    case 'contact':
      return {
        phoneLabel: field(form, 'phoneLabel'),
        phoneHref: field(form, 'phoneHref'),
        email: field(form, 'email'),
        addressLines: lines(form, 'addressLines'),
        postalCode: field(form, 'postalCode'),
        city: field(form, 'city'),
        country: field(form, 'country'),
        hours: field(form, 'hours'),
        website: field(form, 'website'),
      };
    case 'seo':
      return {
        defaultMetaTitle: field(form, 'defaultMetaTitle'),
        titleTemplate: field(form, 'titleTemplate'),
        defaultMetaDescription: field(form, 'defaultMetaDescription'),
        defaultOgImageMediaId: field(form, 'defaultOgImageMediaId') || null,
        allowIndexing: boolField(form, 'allowIndexing'),
      };
    case 'organization':
      return {
        type: field(form, 'type') || 'LocalBusiness',
        legalName: field(form, 'legalName'),
        vatNumber: field(form, 'vatNumber'),
        sameAs: lines(form, 'sameAs'),
        priceRange: field(form, 'priceRange'),
        areaServed: lines(form, 'areaServed'),
        latitude: numberOrNull(form, 'latitude'),
        longitude: numberOrNull(form, 'longitude'),
      };
    case 'analytics':
      return {
        ga4MeasurementId: field(form, 'ga4MeasurementId'),
        ga4PropertyId: field(form, 'ga4PropertyId').replace(/^properties\//, ''),
        enabled: boolField(form, 'enabled'),
      };
    case 'booking':
      return {
        slotStepMinutes: intOrUndefined(form, 'slotStepMinutes'),
        minNoticeHours: intOrUndefined(form, 'minNoticeHours'),
        horizonDays: intOrUndefined(form, 'horizonDays'),
        defaultBufferAfterMinutes: intOrUndefined(form, 'defaultBufferAfterMinutes'),
        cancelUntilHours: intOrUndefined(form, 'cancelUntilHours'),
        timezone: field(form, 'timezone') || undefined,
        introTitle: field(form, 'introTitle') || undefined,
        introText: field(form, 'introText'),
        confirmationText: field(form, 'confirmationText') || undefined,
        showProviderChoice: boolField(form, 'showProviderChoice'),
      };
  }
}

/**
 * `parseSiteSetting()` in the repo falls back to the defaults for the WHOLE key
 * when a value does not validate, which would silently reset every booking
 * rule. Refuse out-of-range numbers here instead, with a readable message.
 */
function bookingProblem(form: FormData): string | null {
  const checks: Array<[string, string, number, number]> = [
    ['slotStepMinutes', 'Tijdsraster', 5, 240],
    ['minNoticeHours', 'Minimale voorafgaande termijn', 0, 1440],
    ['horizonDays', 'Boekingshorizon', 1, 730],
    ['defaultBufferAfterMinutes', 'Standaard buffer', 0, 240],
    ['cancelUntilHours', 'Annuleren tot', 0, 1440],
  ];
  for (const [name, label, min, max] of checks) {
    const raw = field(form, name);
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      return `${label}: geef een geheel getal tussen ${min} en ${max}.`;
    }
  }
  const timezone = field(form, 'timezone');
  if (timezone && !isValidTimeZone(timezone)) {
    return 'Tijdzone: gebruik een IANA-naam zoals Europe/Brussels.';
  }
  return null;
}

export async function updateSettingAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const key = field(form, 'key');
    if (!isSiteSettingKey(key)) return actionError('Onbekende instelling.');

    const locale = field(form, 'locale') || DEFAULT_LOCALE;
    if (key === 'booking') {
      const problem = bookingProblem(form);
      if (problem) return actionError(problem);
    }
    const value = valueFor(key, form);

    for (const candidate of [field(form, 'phoneHref'), field(form, 'website')]) {
      if (candidate && isUnsafeUrl(candidate)) {
        return actionError('Een van de links gebruikt een niet-toegelaten schema.');
      }
    }

    const result = await updateSiteSetting(locale, key, value);
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/settings');
    return actionOk('Instellingen opgeslagen.');
  });
}
