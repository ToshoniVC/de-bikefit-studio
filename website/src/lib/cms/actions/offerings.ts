'use server';

import { revalidatePath } from 'next/cache';
import { euroInputToCents } from '@/lib/booking/format';
import {
  audiencesFor,
  AUDIENCE_LABELS,
  OFFERING_BOOKING_MODES,
  OFFERING_VARIANT_MODES,
  type OfferingBookingMode,
  type OfferingVariantMode,
} from '@/lib/offers/offering';
import { saveOffering } from '@/lib/offers/repo';
import { runAction } from './run';
import { actionError, actionOk, boolField, field, type ActionState } from './state';

/**
 * Beheer → Aanbod. One action per offering card: the form's fields become the
 * settings object `saveOffering()` validates again (zod), after it checked
 * `offering.manage` itself — this wrapper is not the boundary
 * (`offerings.test.ts` calls it directly as a provider and as an editor).
 */

function oneOf<T extends string>(value: string, options: readonly T[]): T | null {
  return (options as readonly string[]).includes(value) ? (value as T) : null;
}

export async function saveOfferingAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const pageId = field(form, 'pageId');
    if (!pageId) return actionError('Dit aanbod bestaat niet (meer).');
    const bookingMode = oneOf<OfferingBookingMode>(
      field(form, 'bookingMode'),
      OFFERING_BOOKING_MODES,
    );
    const variantMode = oneOf<OfferingVariantMode>(
      field(form, 'variantMode'),
      OFFERING_VARIANT_MODES,
    );
    if (!bookingMode || !variantMode) return actionError('Kies hoe dit aanbod geboekt wordt.');

    const variants = [];
    for (const audience of audiencesFor(variantMode)) {
      const priceCents = euroInputToCents(field(form, `price:${audience}`));
      if (priceCents === undefined) {
        const which = AUDIENCE_LABELS[audience];
        return actionError(
          `${which ? `${which}: g` : 'G'}eef de prijs in euro, bv. 150 of 149,50, of laat het veld leeg voor “Prijs op aanvraag”.`,
        );
      }
      variants.push({
        audience,
        serviceId: field(form, `service:${audience}`) || null,
        priceCents,
      });
    }

    const result = await saveOffering(pageId, {
      isListed: boolField(form, 'isListed'),
      bookingMode,
      variantMode,
      variants,
    });
    if (!result.ok) return actionError(result.message);
    revalidatePath('/admin/aanbod');
    revalidatePath('/admin/services');
    return actionOk('Aanbod opgeslagen. De website toont het meteen zo.');
  });
}
