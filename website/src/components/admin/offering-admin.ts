import 'server-only';

import type { MediaOption } from '@/components/admin/media-picker';
import type { OfferingFormValues } from '@/components/admin/offering-form';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { listMedia } from '@/lib/cms/repo';
import { EMPTY_OFFERING_CONTENT } from '@/lib/offers/offering-content';
import type { AdminOffering, AdminOfferingService } from '@/lib/offers/repo';

/**
 * Maps `@/lib/offers/repo` results onto the plain, serialisable props of the
 * Aanbod admin screens (`offering-form.tsx`). Server-only, like `booking-rows.ts`.
 */

export function toOfferingFormValues(
  offering: AdminOffering | null,
  services: readonly AdminOfferingService[],
): OfferingFormValues {
  if (!offering) {
    return {
      id: null,
      content: EMPTY_OFFERING_CONTENT,
      isListed: true,
      bookingMode: 'enquiry',
      variantMode: 'single',
      variants: [],
    };
  }
  return {
    id: offering.id,
    content: offering.content,
    isListed: offering.settings.isListed,
    bookingMode: offering.settings.bookingMode,
    variantMode: offering.settings.variantMode,
    variants: offering.settings.variants.map((variant) => {
      const service = variant.serviceId
        ? (services.find((entry) => entry.id === variant.serviceId) ?? null)
        : null;
      return {
        audience: variant.audience,
        serviceId: variant.serviceId,
        priceCents: variant.priceCents,
        durationMinutes: service?.durationMinutes ?? null,
        bufferAfterMinutes: service?.bufferAfterMinutes ?? null,
        locationId: service?.locationId ?? null,
        requiresGuardian: service?.requiresGuardian ?? variant.audience === 'youth',
        providerNames: service?.providerNames ?? [],
      };
    }),
  };
}

/** The media library as the picker takes it. */
export async function mediaOptions(): Promise<MediaOption[]> {
  return (await listMedia()).map((item) => ({
    id: item.id,
    filename: item.filename,
    mimeType: item.mimeType,
    alt: item.alt?.[DEFAULT_LOCALE] ?? '',
  }));
}
