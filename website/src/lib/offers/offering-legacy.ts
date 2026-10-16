import { formatPrice } from '@/lib/booking/format';
import { OFFER_PRICE_FALLBACK } from './catalogue';
import {
  OFFERING_MAX_PRICE_CENTS,
  type OfferingServiceInfo,
  type OfferingSettings,
} from './offering';

/**
 * The settings an offer page had before Beheer → Aanbod existed, derived from
 * its `offer` block. Split from `./offering.ts` (size limit); re-exported
 * there. Plain module, unit-tested in `offering.test.ts`.
 */

/** The legacy fields of an `offer` block (structural, so tests need no registry). */
export type LegacyOfferFields = {
  bookingServiceSlugs: readonly string[];
  priceCents: number | null;
  priceLabel: string;
};

export type LegacyDerivation = {
  settings: OfferingSettings;
  /**
   * `true` when the settings reproduce exactly what the page showed before
   * (price, duration source, booking route). The migration script writes only
   * exact derivations; the rest wait for an editor in Beheer → Aanbod.
   */
  exact: boolean;
  /** Dutch, for the admin screen and the migration report. */
  notes: string[];
};

function isPricePlaceholder(label: string): boolean {
  const trimmed = label.trim();
  return !trimmed || trimmed.toLowerCase() === OFFER_PRICE_FALLBACK.toLowerCase();
}

/**
 * What an offer page without a `cms_offerings` row means, in the new model,
 * reproducing its public behaviour before this change:
 *
 *  - no linked service → `enquiry`, one option, the editorial cents as price
 *    (a free-text label other than "Prijs op aanvraag" cannot be carried over:
 *    not exact);
 *  - one linked service → `direct`, one option booked as that service;
 *  - two linked services, one with a guardian rule (Jeugdfit) and one without
 *    (Volwassenenfit) → `direct`, Volwassene and Jeugd;
 *  - anything else (unknown slug, more services, no guardian split) → the
 *    closest setting, not exact.
 *
 * Linked offers showed "Prijs op aanvraag" on their pages (guard of 16 Oct
 * 2026), so their variants get NO price here: a price a service shows in the
 * widget is never copied onto the offer page without an editor deciding so.
 */
export function deriveLegacyOffering(
  block: LegacyOfferFields,
  services: readonly OfferingServiceInfo[],
): LegacyDerivation {
  const notes: string[] = [];
  const slugs = [...new Set(block.bookingServiceSlugs.map((slug) => slug.trim()).filter(Boolean))];

  if (slugs.length === 0) {
    let priceCents: number | null = null;
    let exact = true;
    if (!isPricePlaceholder(block.priceLabel)) {
      exact = false;
      notes.push(
        `Het vrije prijslabel “${block.priceLabel.trim()}” kan niet overgenomen worden; vul een bedrag in of laat “Prijs op aanvraag”.`,
      );
    } else if (block.priceCents != null) {
      if (block.priceCents >= 1 && block.priceCents <= OFFERING_MAX_PRICE_CENTS) {
        priceCents = block.priceCents;
      } else {
        exact = false;
        notes.push('Het bedrag op de pagina is geen geldige prijs en werd niet overgenomen.');
      }
    }
    return {
      settings: {
        isListed: true,
        bookingMode: 'enquiry',
        variantMode: 'single',
        variants: [{ audience: 'all', serviceId: null, priceCents }],
      },
      exact,
      notes,
    };
  }

  const resolved: OfferingServiceInfo[] = [];
  for (const slug of slugs) {
    const service = services.find((entry) => entry.slug === slug);
    if (service) resolved.push(service);
    else notes.push(`De gekoppelde dienst “${slug}” bestaat niet.`);
  }
  for (const service of resolved) {
    if (service.showPrice && service.priceCents != null) {
      notes.push(
        `${service.name} toont in de boekingswidget een eigen prijs (${formatPrice(service.priceCents)}); die werd niet op het aanbod gezet. Vul hem hier in als hij op het aanbod mag.`,
      );
    }
  }
  if (resolved.length === 0) {
    notes.push('Geen geldige dienst gekoppeld: het aanbod wordt een aanvraag via het formulier.');
    return {
      settings: {
        isListed: true,
        bookingMode: 'enquiry',
        variantMode: 'single',
        variants: [{ audience: 'all', serviceId: null, priceCents: null }],
      },
      exact: false,
      notes,
    };
  }

  const exactSoFar = notes.length === 0;
  if (resolved.length === 1) {
    return {
      settings: {
        isListed: true,
        bookingMode: 'direct',
        variantMode: 'single',
        variants: [{ audience: 'all', serviceId: resolved[0].id, priceCents: null }],
      },
      exact: exactSoFar,
      notes,
    };
  }

  const youth = resolved.filter((service) => service.requiresGuardian);
  const adult = resolved.filter((service) => !service.requiresGuardian);
  if (resolved.length === 2 && youth.length === 1 && adult.length === 1) {
    return {
      settings: {
        isListed: true,
        bookingMode: 'direct',
        variantMode: 'audience',
        variants: [
          { audience: 'adult', serviceId: adult[0].id, priceCents: null },
          { audience: 'youth', serviceId: youth[0].id, priceCents: null },
        ],
      },
      exact: exactSoFar,
      notes,
    };
  }

  notes.push(
    'De gekoppelde diensten zijn niet te verdelen in Volwassene en Jeugd; enkel de eerste blijft over.',
  );
  return {
    settings: {
      isListed: true,
      bookingMode: 'direct',
      variantMode: 'single',
      variants: [{ audience: 'all', serviceId: resolved[0].id, priceCents: null }],
    },
    exact: false,
    notes,
  };
}
